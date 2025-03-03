import WorkerApi from "./worker-api";

/**
 * @typedef {import("./worker-api").StderrMessage} StderrMessage
 * @typedef {import("./worker-api").StdoutMessage} StdoutMessage
 */

export default class PythonRunner extends WorkerApi {
  /** @type {(content: string) => void} */
  stderrFunc = (_content) => {};

  /** @type {(content: string) => void} */
  stdoutFunc = (_content) => {};

  /**
   * @param {StderrMessage} message
   * @returns {void}
   */
  onStderr(message) {
    console.log("stderr:", message.stderr);
    this.stderrFunc(message.stderr);
  }

  /**
   * @param {StdoutMessage} message
   * @returns {void}
   */
  onStdout(message) {
    this.stdoutFunc(message.stdout);
  }
}
