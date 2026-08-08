FROM emscripten/emsdk@sha256:4c3e0a0dac61430b719e82118ae9b2c7480902a2713267e80fa296d39f7ab921 AS source-base

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    bash \
    build-essential \
    cmake \
    curl \
    git \
    libbz2-dev \
    libffi-dev \
    libgdbm-dev \
    libncurses5-dev \
    libnss3-dev \
    libreadline-dev \
    libsqlite3-dev \
    libssl-dev \
    npm \
    python3 \
    python3-pip \
    python3-setuptools \
    zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir \
  argparse==1.4.0 \
  cerberus==1.3.4 \
  libclang==15.0.6.1 \
  pyyaml==6.0

COPY sources /tmp/vibeshape-occt-sources

RUN mkdir -p /rapidjson /freetype /occt /opencascade.js \
  && tar -xzf /tmp/vibeshape-occt-sources/rapidjson.tar.gz --strip-components=1 -C /rapidjson \
  && tar -xzf /tmp/vibeshape-occt-sources/freetype.tar.gz --strip-components=1 -C /freetype \
  && tar -xzf /tmp/vibeshape-occt-sources/occt.tar.gz --strip-components=1 -C /occt \
  && tar -xzf /tmp/vibeshape-occt-sources/opencascade-js.tar.gz --strip-components=1 -C /opencascade.js \
  && rm -rf /tmp/vibeshape-occt-sources

ENV threading=single-threaded
WORKDIR /opencascade.js
RUN mkdir -p build dist \
  && /opencascade.js/src/applyPatches.py

FROM source-base AS source-objects
RUN /opencascade.js/src/compileSources.py single-threaded

FROM source-objects AS unpatched-builder
COPY config/configured-bindings.txt /tmp/vibeshape-configured-bindings.txt
COPY scripts/generate-configured-bindings.py /opencascade.js/src/generate-configured-bindings.py
RUN python3 /opencascade.js/src/generate-configured-bindings.py all /tmp/vibeshape-configured-bindings.txt \
  && /opencascade.js/src/compileBindings.py single-threaded \
  && chmod -R 777 /opencascade.js /occt
WORKDIR /src
ENTRYPOINT ["/opencascade.js/src/buildFromYaml.py"]

FROM unpatched-builder AS patched-builder
COPY patches/bindings.py /opencascade.js/src/bindings.py
WORKDIR /opencascade.js/src
RUN find /opencascade.js/build/bindings -type f \( -name '*.cpp' -o -name '*.cpp.o' \) -delete \
  && python3 /opencascade.js/src/generate-configured-bindings.py embind /tmp/vibeshape-configured-bindings.txt \
  && /opencascade.js/src/compileBindings.py single-threaded \
  && chmod -R 777 /opencascade.js /occt
WORKDIR /src
ENTRYPOINT ["/opencascade.js/src/buildFromYaml.py"]
