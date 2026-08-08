#!/usr/bin/python3

import argparse
import os

import generateBindings as upstream


def read_symbols(path):
  with open(path, "r", encoding="utf8") as symbol_file:
    symbols = {line.strip() for line in symbol_file if line.strip()}

  if not symbols:
    raise RuntimeError("The configured OCCT binding allowlist is empty.")

  return symbols


def write_bindings(extension, preamble, processors, symbols):
  translation_unit = upstream.parse()
  typedefs = upstream.typedefGenerator(translation_unit)
  template_typedefs = upstream.templateTypedefGenerator(translation_unit)

  for generator, filter_function, process_function in processors:
    for child in generator(translation_unit):
      if child.spelling not in symbols or not filter_function(child, False):
        continue

      relative_source = child.extent.start.file.name.replace(upstream.occtBasePath, "")
      output_directory = os.path.join(
        upstream.buildDirectory,
        "bindings",
        relative_source,
      )
      upstream.mkdirp(output_directory)
      output_path = os.path.join(output_directory, child.spelling + extension)

      print("Processing " + child.spelling)
      try:
        output = process_function(
          translation_unit,
          preamble,
          child,
          typedefs,
          template_typedefs,
        )
        with open(output_path, "w", encoding="utf8") as output_file:
          output_file.write(output)
      except upstream.SkipException as error:
        print(str(error))


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("mode", choices=["all", "embind"])
  parser.add_argument("symbols")
  arguments = parser.parse_args()
  symbols = read_symbols(arguments.symbols)
  embind_processors = [
    (
      upstream.allChildrenGenerator,
      upstream.filterClasses,
      upstream.embindGenerationFuncClasses,
    ),
    (
      upstream.templateTypedefGenerator,
      upstream.filterTemplates,
      upstream.embindGenerationFuncTemplates,
    ),
    (
      upstream.enumGenerator,
      upstream.filterEnums,
      upstream.embindGenerationFuncEnums,
    ),
  ]
  embind_preamble = (
    upstream.ocIncludeStatements + "\n" + upstream.referenceTypeTemplateDefs
  )
  write_bindings(".cpp", embind_preamble, embind_processors, symbols)

  if arguments.mode == "all":
    typescript_processors = [
      (
        upstream.allChildrenGenerator,
        upstream.filterClasses,
        upstream.typescriptGenerationFuncClasses,
      ),
      (
        upstream.templateTypedefGenerator,
        upstream.filterTemplates,
        upstream.typescriptGenerationFuncTemplates,
      ),
      (
        upstream.enumGenerator,
        upstream.filterEnums,
        upstream.typescriptGenerationFuncEnums,
      ),
    ]
    write_bindings(".d.ts.json", "", typescript_processors, symbols)


if __name__ == "__main__":
  main()
