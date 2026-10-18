export function parseUiPluginJson(source: string): unknown {
  return JSON.parse(source, (key: string, value: unknown) => {
    if (key === "__proto__" || key === "constructor" || key === "prototype")
      throw new Error("Reserved plugin data key")
    return value
  })
}
