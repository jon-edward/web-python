// Pyodide webworker script.
//
// Defines functionality which can be used by different APIs.

importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

/** @type {Promise<import("idb-keyval").IDBKeyval>} */
const idbKeyvalPromise = import(
  "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js"
);

/** @type {Promise<import("pyodide").PyodideApi>} */
const pyodidePromise = loadPyodide();

/** @type {string} */
const mountPoint = "/home/pyodide/";

/**
 * @typedef {Object} InitMessage A request to initialize the interpreter.
 * @property {"init"} kind
 * @property {number} id
 * @property {SharedArrayBuffer} buffer
 *
 * @typedef {Object} RunMessage A request to run some Python code.
 * @property {"run"} kind
 * @property {number} id
 * @property {string} python
 * @property {boolean} syncFs
 * @property {Object} options
 *
 * @typedef {Object} PingMessage A request to respond whenever able.
 * @property {"ping"} kind
 * @property {number} id
 */

/**
 * @param {string} stdout
 * @returns {void}
 */
function sendStdout(stdout) {
  self.postMessage({ kind: "stdout", stdout });
}

/**
 * @param {string} stderr
 * @returns {void}
 */
function sendStderr(stderr) {
  self.postMessage({ kind: "stderr", stderr });
}

/**
 * @param {SetInterruptBufferMessage} message
 * @returns {void}
 */
async function onInit(message) {
  const { interruptBuffer, id } = message;

  try {
    const pyodide = await pyodidePromise;

    pyodide.setInterruptBuffer(interruptBuffer);

    pyodide.setStdout({ batched: sendStdout });
    pyodide.setStderr({ batched: sendStderr });

    self.postMessage({ kind: "finished", id });
  } catch (e) {
    self.postMessage({
      kind: "finished",
      error: error.message,
      id,
    });
  }
}

let requirementsHash = "";

/**
 * @param {RunMessage} message
 */
async function onRun(message) {
  let result;
  let error;

  const { python, id, options, syncFs } = message;

  let oldArgs;

  try {
    const pyodide = await pyodidePromise;

    const { get } = await idbKeyvalPromise;

    const directoryHandle = await get("projectDirectoryHandle");

    let nativefs;

    if (directoryHandle) {
      nativefs = await pyodide.mountNativeFS(mountPoint, directoryHandle);
    }

    const loadPackagesOptions = { messageCallback: (_s) => {} };

    // Run Python and send uncaught errors to stderr
    try {
      await pyodide.loadPackage("micropip", loadPackagesOptions);

      const requirementsLocals = pyodide.toPy({
        requirementsHash,
        mountPoint,
      });

      // Install all requirements if requirements.txt has changed
      requirementsHash = await pyodide.runPythonAsync(
        `
        import hashlib
        import json
        import micropip 
        import pathlib
        import sys

        req_f = pathlib.Path("requirements.txt")
        reqs = []

        md5 = hashlib.md5()
        hex_digest = ""

        if req_f.is_file():
            req_content = req_f.read_bytes()
            md5.update(req_content)

            hex_digest = md5.hexdigest()

            if hex_digest != requirementsHash:
                hex_digest = md5.hexdigest()
                reqs = [x.strip() for x in req_content.decode("utf-8").split("\\n") if x.strip()]
                await micropip.install(reqs, keep_going=True)

        for name, module in list(sys.modules.items()):
            if not hasattr(module, "__file__") or not module.__file__:
                continue
            
            if module.__file__.startswith(mountPoint):
                del sys.modules[name]

        hex_digest
    `,
        { locals: requirementsLocals }
      );

      if (options.args) {
        // Hack, replaces sys.argv

        oldArgs = await pyodide.runPythonAsync(
          `
            import sys
            sys.argv
          `
        );

        await pyodide.runPythonAsync(
          `
          import sys
          sys.argv = args
        `,
          {
            locals: pyodide.toPy({
              args: options.args,
            }),
          }
        );
      }

      await pyodide.loadPackagesFromImports(python, loadPackagesOptions);

      const filename = options.filename || "<exec>";

      const opts = {};

      if (options.locals) {
        opts.locals = pyodide.toPy({
          ...options.locals,
        });
      }

      if (options.globals) {
        opts.globals = pyodide.toPy({
          ...options.globals,
        });
      }

      if (options.filename) {
        opts.filename = filename;
      }

      result = await pyodide.runPythonAsync(python, opts);
      if (result && typeof result.toJs === "function") result = result.toJs();
    } catch (e) {
      console.error(e);
      error = await pyodide.runPythonAsync(
        `
        import sys
        import traceback
        
        exc = sys.last_exc 
        tb = exc.__traceback__.tb_next.tb_next
        
        "".join(traceback.format_exception(None, value=exc, tb=tb))
      `
      );
    } finally {
      if (options.args) {
        await pyodide.runPythonAsync(
          `
          import sys
          sys.argv = oldArgs
        `,
          {
            locals: pyodide.toPy({
              oldArgs,
            }),
          }
        );
      }
    }

    if (nativefs !== undefined) {
      if (syncFs) await nativefs.syncfs();
      // To see remote changes that occur between the end of this run
      // and the start of the next run, the mounted directory needs to be
      // remounted.
      pyodide.FS.unmount(mountPoint);
      if (syncFs) await nativefs.syncfs();
    }
  } catch (e) {
    error = e.message;
    console.error(e);
  }

  self.postMessage({ kind: "finished", result, error, id });
}

/**
 * @param {MessageEvent<SetInterruptBufferMessage | RunMessage>} event
 */
self.onmessage = async (event) => {
  const { data } = event;

  switch (data.kind) {
    case "ping":
      self.postMessage({ kind: "ping", id: data.id });
      break;
    case "init":
      // Initialize interpreter with interrupt buffer and set io functions.
      onInit(data);
      break;
    case "run":
      // Run some code.
      onRun(data);
      break;
  }
};
