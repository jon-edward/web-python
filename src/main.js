import "./style.css";

import PythonRunner from "./worker/python-runner";
import MypyTypeChecker from "./worker/mypy-type-checker";

import { set, get } from "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js";

document.getElementById("stdout").innerHTML = `Welcome to web-python! 

Select a local directory to run Python code in, enter arguments to pass to the Python interpreter, and click "Run".

For example, to run the Python file "main.py" with arguments "arg1" and "arg2", enter "main.py arg1 arg2" as Python arguments.

See the <a href="/?about">about page</a> for more information.`;

function openAboutPage() {
  window.history.replaceState({}, document.title, "/?about");
  document.getElementById("about-dialog").showModal();
}

function closeAboutPage() {
  window.history.replaceState({}, document.title, "/");
  document.getElementById("about-dialog").close();
}

// Close the about page if the user clicks outside
document
  .getElementById("about-dialog")
  .addEventListener("click", function (event) {
    const rect = event.target.getBoundingClientRect();
    const isInDialog =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!isInDialog) {
      closeAboutPage();
    }
  });

if (new URLSearchParams(window.location.search).has("about")) {
  openAboutPage();
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    // Override default behavior to close the about page and change history
    event.preventDefault();
    closeAboutPage();
  }
});

document.getElementById("about-button").onclick = openAboutPage;
document.getElementById("about-dialog-close-button").onclick = closeAboutPage;

for (const button of document.getElementsByTagName("button")) {
  button.classList.add("bg-tertiary", "hoverable", "focusable");
}

for (const input of document.getElementsByTagName("input")) {
  input.classList.add("bg-secondary", "focusable");
}

async function init() {
  let pythonRunner = new PythonRunner();
  let mypyTypeChecker = new MypyTypeChecker();

  let didRunOnce = false;

  /**
   * @returns {boolean}
   */
  function isStdoutScrolledDown() {
    const stdout = document.getElementById("stdout");
    return (
      Math.abs(stdout.scrollHeight - stdout.scrollTop - stdout.clientHeight) <
      10 // arbitrary tolerance
    );
  }

  const enterTriggerable = document.getElementsByClassName(
    "enter-key-triggerable"
  );
  for (const elem of enterTriggerable) {
    elem.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.target.click();
      }
    });
  }

  /**
   * @param {string} text
   */
  function stdoutFunc(text) {
    const stdout = document.getElementById("stdout");
    const isScrolled = isStdoutScrolledDown();
    const contentElem = document.createElement("span");
    contentElem.textContent = `${text}\n`;
    stdout.appendChild(contentElem);
    if (isScrolled) stdout.scrollTop = stdout.scrollHeight;
  }

  /**
   * @param {string} text
   */
  function stderrFunc(text) {
    const stdout = document.getElementById("stdout");
    const isScrolled = isStdoutScrolledDown();
    const contentElem = document.createElement("span");
    contentElem.textContent = `${text}\n`;
    contentElem.setAttribute("data-kind", "error");
    stdout.appendChild(contentElem);
    if (isScrolled) if (isScrolled) stdout.scrollTop = stdout.scrollHeight;
  }

  pythonRunner.stdoutFunc = stdoutFunc;
  pythonRunner.stderrFunc = stderrFunc;

  /**
   * @type {boolean}
   */
  let stdoutResizeSelected = false;

  document
    .getElementById("stdout-resize")
    .addEventListener("mousedown", (_event) => {
      stdoutResizeSelected = true;
      document.body.addEventListener("mousemove", resizingMove);
      document.body.addEventListener("mouseup", finishResizing);
    });

  document
    .getElementById("stdout-resize")
    .addEventListener("touchstart", (event) => {
      event.preventDefault();
      stdoutResizeSelected = true;
      document.body.addEventListener("touchmove", resizingMove, {
        passive: false,
      });
      document.body.addEventListener("touchend", finishResizing);
    });

  /**
   * @param {MouseEvent} event
   */
  function resizingMove(event) {
    if (stdoutResizeSelected) {
      document.body.style.setProperty("user-select", "none");
      document.body.style.setProperty("-moz-user-select", "none");

      let clientX = event.clientX;

      if (event.type === "touchmove") {
        event.preventDefault();
        clientX = event.touches[0].clientX;
      }

      const stdout = document.getElementById("stdout");
      const stdoutRect = stdout.getBoundingClientRect();
      stdout.style.width = `${clientX - stdoutRect.left - 25}px`;
    } else {
      finishResizing();
    }
  }

  const finishResizing = () => {
    stdoutResizeSelected = false;
    document.body.removeEventListener("mouseup", finishResizing);
    document.body.removeEventListener("touchend", finishResizing);

    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("-moz-user-select");

    document
      .getElementById("stdout-resize")
      .removeEventListener("mousemove", resizingMove);
    document
      .getElementById("stdout-resize")
      .removeEventListener("touchmove", resizingMove);
  };

  /**
   * @returns {Promise<FileSystemDirectoryHandle | null>}
   */
  async function requestProjectDirectory() {
    if (!("showDirectoryPicker" in window))
      throw new Error(
        "This browser does not support file system directory handles."
      );

    let handle;

    try {
      handle = await window.showDirectoryPicker({
        mode: "readwrite",
      });
    } catch (e) {
      if (e.name === "AbortError") {
        return null;
      }
      console.error(e);
      throw Error("Could not open project directory (see developer console).");
    }

    if (
      !("requestPermission" in handle) ||
      (await handle.requestPermission()) !== "granted"
    ) {
      throw new Error(
        "This browser does not support writable file system directory handles."
      );
    }

    return handle;
  }

  /**
   * @param {boolean} ready
   */
  function setIsReady(ready) {
    document.getElementById("run-button").disabled = !ready;
    document.getElementById("stop-button").disabled = ready;
  }

  async function refreshProjectDirectory() {
    const handle = await get("projectDirectoryHandle");
    if (handle) {
      document.getElementById("project-directory-name").textContent =
        handle.name;
      document.getElementById("project-directory-name");
    } else {
      document.getElementById("project-directory-name").textContent =
        "No directory selected";
    }

    document
      .getElementById("project-directory-name")
      .removeAttribute("data-kind");
  }

  await refreshProjectDirectory();

  document.getElementById("project-directory").onclick = async () => {
    const projectDirectoryNameElement = document.getElementById(
      "project-directory-name"
    );

    try {
      const handle = await requestProjectDirectory();
      await set("projectDirectoryHandle", handle);
      await refreshProjectDirectory();
    } catch (e) {
      projectDirectoryNameElement.textContent = `Error: ${e.message}`;
      projectDirectoryNameElement.setAttribute("data-kind", "error");
    }
  };

  document.getElementById("mypy-run-checkbox").onchange = async (event) => {
    const mypyOutput = document.getElementById("mypy-output");
    const stdout = document.getElementById("stdout");
    const stdoutResize = document.getElementById("stdout-resize");
    const checked = event.currentTarget.checked;

    mypyTypeChecker.active = checked;
    mypyOutput.style.display = checked ? "block" : "none";
    stdoutResize.style.display = checked ? "block" : "none";
    stdout.style.width = checked ? "70%" : "100%";

    // Store user mypy start state
    await set("mypyTypeChecking", checked);
  };

  document.getElementById("clear-when-run-checkbox").onchange = async (
    event
  ) => {
    await set("clearTerminalWhenRun", event.currentTarget.checked);
  };

  // Get start states
  const mypyStartChecked = await get("mypyTypeChecking");
  document.getElementById("mypy-run-checkbox").checked = mypyStartChecked;
  document
    .getElementById("mypy-run-checkbox")
    .dispatchEvent(new Event("change"));

  const clearTerminalWhenRunStartChecked = await get("clearTerminalWhenRun");
  document.getElementById("clear-when-run-checkbox").checked =
    clearTerminalWhenRunStartChecked;
  document
    .getElementById("clear-when-run-checkbox")
    .dispatchEvent(new Event("change"));

  const pythonArgsStart = await get("pythonArgs");
  document.getElementById("python-args").value =
    pythonArgsStart || "-c \"print('hello, web-python!')\"";

  /**
   * @param {MypyResult} output
   */
  function showMypyOutput(output) {
    const mypyOutput = document.getElementById("mypy-output");
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

  mypyTypeChecker.typeCheckedCallback = showMypyOutput;
  mypyTypeChecker.typeCheckForever();

  document.getElementById("stop-button").onclick = async () => {
    await pythonRunner.stop();
    setIsReady(true);
  };

  class RunnerError extends Error {}

  document.getElementById("python-args").oninput = async () => {
    document.getElementById("python-args-error-span").textContent = "";
    await refreshProjectDirectory();
  };

  document.getElementById("run-button").onclick = async () => {
    setIsReady(false);
    await refreshProjectDirectory();

    document.getElementById("python-args-error-span").textContent = "";

    if (
      document.getElementById("clear-when-run-checkbox").checked ||
      !didRunOnce
    ) {
      document.getElementById("stdout").textContent = "";
    }

    didRunOnce = true;

    const pythonArgsElement = document.getElementById("python-args");
    const pythonArgs = pythonArgsElement.value;

    try {
      if (!pythonArgs) {
        document.getElementById("python-args-error-span").textContent =
          "No Python arguments provided.";
        throw new RunnerError("No Python arguments provided.");
      }

      const pathParsingOutput = await pythonRunner.runPython(
        `
        import json
        import os
        import shlex
        split_args = shlex.split(pythonArgs)
        
        (split_args, os.path.normpath(split_args[0] if len(split_args) > 0 else "").split(os.sep))
      `,
        {
          locals: {
            pythonArgs,
          },
        }
      );

      if (pathParsingOutput.error) {
        // Error happened while parsing arguments
        stderrFunc(pathParsingOutput.error);
        throw new RunnerError(
          `Error parsing Python arguments. Check terminal.`
        );
      }

      const [splitArgs, pythonPathSegments] = pathParsingOutput.result;

      let result;

      if (splitArgs.length === 0) {
        throw new RunnerError("No Python arguments provided.");
      } else if (splitArgs[0] === "-c" && splitArgs.length === 2) {
        // Emulate python -c behavior
        result = await pythonRunner.runPython(splitArgs[1], {
          filename: "<string>",
        });
      } else {
        let directoryHandle = await get("projectDirectoryHandle");
        if (!directoryHandle) {
          stderrFunc("Tried to run a Python file, but no directory selected.");
          throw new RunnerError("No directory selected.");
        }
        try {
          const subDirectories = pythonPathSegments.slice(0, -1);
          for (const subDirectory of subDirectories) {
            directoryHandle = await directoryHandle.getDirectoryHandle(
              subDirectory
            );
          }
          const pythonContent = await (
            await (
              await directoryHandle.getFileHandle(
                pythonPathSegments[pythonPathSegments.length - 1]
              )
            ).getFile()
          ).text();
          result = await pythonRunner.runPython(pythonContent, {
            filename: pythonPathSegments[pythonPathSegments.length - 1],
            args: splitArgs,
          });
        } catch (e) {
          stderrFunc(e.message);
          throw new RunnerError(
            `Error reading Python file at path: ${pythonPathSegments.join("/")}`
          );
        }
      }

      if (result.error) {
        stderrFunc(result.error);
      }
    } finally {
      setIsReady(true);
      await set("pythonArgs", pythonArgs);
    }
  };

  setIsReady(true);
}

try {
  await init();
} catch (e) {
  // Error happened while initializing
  document.getElementById("controls").style.display = "none";
  document.getElementById("terminal").style.display = "none";
  document.getElementById("error-block").style.display = "block";
  console.error(e);
}
