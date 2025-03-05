// Mypy worker API

import WorkerApi from "./worker-api";

import { get } from "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js";

/**
 * @typedef {[string, string, number]} MypyResult
 */

/**
 * @param {number} millis The duration to delay in milliseconds.
 * @returns {Promise<void>} A promise that resolves after the delay.
 */
async function delay(millis) {
  return new Promise((res) => setTimeout(res, millis));
}

export default class MypyTypeChecker extends WorkerApi {
  /**
   * @type {string | undefined}
   */
  #projectHash;

  /**
   * @type {boolean}
   */
  active = true;

  /**
   * @type {(mypyResult: MypyResult) => void}
   */
  typeCheckedCallback = (_mypyResult) => {};

  /**
   * @returns {Promise<string>}
   */
  async getProjectDirectoryHash() {
    const pythonResult = await this.runPython(
      `
        import hashlib
        from pathlib import Path

        paths = list(str(s) for s in Path("./").glob("**/*.py"))
        paths.sort()

        if not paths:
          raise Exception("No Python source files.")

        py_hash = hashlib.md5()

        for path in paths:
          with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                py_hash.update(chunk)
        
        py_hash.hexdigest()
      `,
      {},
      false
    );
    if (pythonResult.error) {
      if (pythonResult.error.includes("No Python source files.")) {
        return "";
      }
      throw new Error(
        `Error getting project directory hash: ${pythonResult.error}`
      );
    }
    return pythonResult.result;
  }

  /**
   * @returns {Promise<boolean>}
   */
  async projectDirectoryHasChanged() {
    const currentHash = await this.getProjectDirectoryHash();

    if (currentHash === this.#projectHash) {
      return false;
    }

    this.#projectHash = currentHash;
    return true;
  }

  /**
   * @returns {Promise<void>}
   */
  async typeCheckProjectDirectory() {
    if (!(await get("projectDirectoryHandle"))) {
      this.typeCheckedCallback(["", "No directory selected", 1]);
      return;
    }

    try {
      if (!(await this.projectDirectoryHasChanged())) {
        return;
      }
    } catch (e) {
      this.typeCheckedCallback(["", e.message, 1]);
      return;
    }

    if (this.#projectHash === undefined) {
      this.typeCheckedCallback(["", "No directory selected", 1]);
      return;
    }

    if (this.#projectHash === "") {
      this.typeCheckedCallback(["", "No Python source files.", 1]);
      return;
    }

    this.typeCheckedCallback(["", "Type checking...", 1]);

    const pythonResult = await this.runPython(
      `
        import micropip
        from mypy import api
        import json

        await micropip.install("typing-extensions")
        await micropip.install("mypy_extensions")
        
        result = api.run([".", "--exclude", "build/"])

        json.dumps(result)
      `,
      {},
      false
    );

    if (pythonResult.error)
      throw new Error(`Error type checking: ${pythonResult.error}`);

    const mypyResult = JSON.parse(pythonResult.result);

    this.typeCheckedCallback(mypyResult);
  }

  /**
   * @param {number} pollingDurationMillis
   * @returns {Promise<void>}
   */
  async typeCheckForever(pollingDurationMillis = 100) {
    this.typeCheckedCallback(["", "Type checking...", 1]);
    while (true) {
      if (this.active) {
        await this.typeCheckProjectDirectory();
      }
      await delay(pollingDurationMillis);
    }
  }
}
