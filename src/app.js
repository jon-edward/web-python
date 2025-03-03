import { set } from "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js";
import { showDirectoryPicker } from "https://cdn.jsdelivr.net/npm/file-system-access/lib/es2018.js";

import PythonRunner from "./workers/python-runner";
import MypyTypeChecker, { MypyResult } from "./workers/mypy-type-checker";

await set("projectDirectoryHandle", undefined);

/**
 * @type {boolean}
 */
let stdoutResizeSelected = false;

stdoutResize.addEventListener("mousedown", (_event) => {
  stdoutResizeSelected = true;
  document.body.addEventListener("mousemove", resizingMove);
  document.body.addEventListener("mouseup", finishResizing);
});

/**
 * @param {MouseEvent} event
 */
function resizingMove(event) {
  if (stdoutResizeSelected) {
    const stdoutRect = stdout.getBoundingClientRect();
    stdout.style.width = `${event.clientX - stdoutRect.left - 25}px`;
  } else {
    finishResizing();
  }
}

const finishResizing = () => {
  stdoutResizeSelected = false;
  document.body.removeEventListener("mouseup", finishResizing);
  stdoutResize.removeEventListener("mousemove", resizingMove);
};

/**
 * @param {MypyResult} output
 */
function showMypyOutput(output) {
  const mypyOutputHeader = document.createElement("span");
  mypyOutputHeader.textContent = `[mypy report @ ${new Date().toLocaleTimeString()}]\n\n`;

  const errorSpan = document.createElement("span");
  errorSpan.setAttribute("data-kind", output[2] ? "error" : "success");

  errorSpan.textContent = output[0] ? output[0] + "\n\n" : "";

  const infoSpan = document.createElement("span");
  infoSpan.setAttribute("data-kind", "warning");

  infoSpan.textContent = output[1];

  mypyOutput.textContent = "";

  mypyOutput.appendChild(mypyOutputHeader);
  mypyOutput.appendChild(errorSpan);
  mypyOutput.appendChild(infoSpan);
}

/**
 * @typedef {Object} StyledText
 * @property {string} text
 * @property {("success" | "error")?} kind
 *
 * @typedef {Object} AppState
 * @property {boolean} running
 * @property {StyledText?} entryPointName
 * @property {string?} appErrorMessage
 * @property {FileSystemDirectoryHandle?} projectDirectoryHandle
 * @property {FileSystemFileHandle?} entryPointHandle
 * */

export class App {
  /** @type {AppState} */
  state;

  /** @type {PythonRunner | undefined} */
  runnerWorker;

  /** @type {MypyTypeChecker} */
  mypyTypeChecker;

  /** @param {(AppState) => void} renderCallback */
  constructor(renderCallback) {
    const state = {
      running: false,
    };

    this.state = new Proxy(state, {
      set(obj, prop, value) {
        obj[prop] = value;
        renderCallback(readonlyState);
        return true;
      },
    });

    this.readonlyState = readonlyState;

    this.mypyTypeChecker = new MypyTypeChecker();
    this.mypyTypeChecker.typeCheckedCallback = showMypyOutput;
    this.mypyTypeChecker.typeCheckForever();

    document.getElementById("mypy-run-checkbox").onchange = (event) => {
      const checked = event.currentTarget.checked;
      this.mypyTypeChecker.active = checked;

      mypyOutput.style.display = checked ? "block" : "none";
      stdoutResize.style.display = checked ? "block" : "none";
      stdout.style.width = checked ? "70%" : "100%";
    };
  }

  /**
   * @returns {boolean}
   */
  isStdoutScrolledDown() {
    return (
      Math.abs(stdout.scrollHeight - stdout.scrollTop - stdout.clientHeight) <
      10 // arbitrary tolerance
    );
  }

  /**
   * @param {string} text
   */
  stdoutFunc(text) {
    const isScrolled = this.isStdoutScrolledDown();
    const contentElem = document.createElement("span");
    contentElem.textContent = `${text}\n`;
    stdout.appendChild(contentElem);
    if (isScrolled) stdout.scrollTop = stdout.scrollHeight;
  }

  /**
   * @param {string} text
   */
  stderrFunc(text) {
    const isScrolled = this.isStdoutScrolledDown();
    const contentElem = document.createElement("span");
    contentElem.textContent = `${text}\n`;
    contentElem.setAttribute("data-kind", "error");
    stdout.appendChild(contentElem);
    if (isScrolled) if (isScrolled) stdout.scrollTop = stdout.scrollHeight;
  }

  async requestProjectDirectory() {
    let handle;

    try {
      handle = await showDirectoryPicker({ mode: "readwrite" });

      if (!handle) {
        return;
      }

      if (
        !("requestPermission" in handle) ||
        (await handle.requestPermission({ mode: "readwrite" })) !== "granted"
      ) {
        this.state.appErrorMessage =
          "This browser does not support writable file system directory handles.";
        return;
      }
    } catch (e) {
      if (!(e instanceof DOMException)) {
        this.state.appErrorMessage =
          "Error encountered. Check developer console.";
        throw e;
      }
      // Cancelling raises a DOMException, treat every other
      // kind of error like normal.
    }

    if (!handle) return;

    if (
      this.state.projectDirectoryHandle &&
      (await this.state.projectDirectoryHandle.isSameEntry(handle))
    ) {
      return;
    }

    await set("projectDirectoryHandle", handle);
    this.state.projectDirectoryHandle = handle;
    this.state.entryPointHandle = undefined;
    this.state.entryPointName = undefined;
    // Clear entry point location on
    // project directory change.

    this.runnerWorker = new PythonRunner();

    this.runnerWorker.stdoutFunc = (s) => this.stdoutFunc(s);
    this.runnerWorker.stderrFunc = (s) => this.stderrFunc(s);
  }

  async requestEntryPoint() {
    /**
     * @type {OpenFilePickerOptions}
     */
    const pickerOpts = {
      types: [
        {
          description: "Entry point script",
          accept: { "text/x-python": [".py"] },
        },
      ],
      excludeAcceptAllOption: true,
      multiple: false,
    };

    const [fileHandle] = await window.showOpenFilePicker(pickerOpts);

    fileHandle;

    if (!this.state.projectDirectoryHandle)
      throw new Error("Project handle is not defined.");

    const pathSegments = await this.state.projectDirectoryHandle.resolve(
      fileHandle
    );

    if (!pathSegments) {
      this.state.entryPointName = {
        kind: "error",
        text: "Entry point provided not in project directory.",
      };
      return;
    }

    await set("entryPointHandle", fileHandle);
    this.state.entryPointHandle = fileHandle;

    this.state.entryPointName = {
      kind: "success",
      text: pathSegments.join("/"),
    };
  }

  async run() {
    this.state.running = true;

    if (this.runnerWorker === undefined) {
      this.runnerWorker = new PythonRunner();
      this.runnerWorker.stdoutFunc = (s) => this.stdoutFunc(s);
      this.runnerWorker.stderrFunc = (s) => this.stderrFunc(s);
    }

    try {
      document.getElementById("stop-button").onclick = async () => {
        // Throw away interpreter, and redirect erroring.
        if (this.runnerWorker === undefined) return;

        this.runnerWorker.stdoutFunc = (_s) => {};
        this.runnerWorker.stderrFunc = (_s) => {};
        this.state.running = false;
        this.runnerWorker.stop();

        this.runnerWorker = undefined;
      };

      const mainContent = await (
        await this.state.entryPointHandle.getFile()
      ).text();

      const result = await this.runnerWorker.runPython(
        mainContent,
        this.state.entryPointName.text
      );

      if (result.error) this.stderrFunc(result.error);
    } catch (e) {
      // Force new PyWorker creation on error.
      this.runnerWorker = undefined;
      console.error(e);
    } finally {
      this.state.running = false;
    }
  }
}
