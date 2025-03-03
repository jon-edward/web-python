/// Worker API

/**
 * @typedef {Object} FinishedMessage
 * @property {"finished"} kind
 * @property {number} id
 * @property {string?} error
 * @property {any?} result
 *
 * @typedef {Object} StdoutMessage
 * @property {"stdout"} kind
 * @property {string} stdout
 *
 * @typedef {Object} StderrMessage
 * @property {"stderr"} kind
 * @property {string} stderr
 *
 * @typedef {Object} PingMessage
 * @property {"ping"} kind
 * @property {number} id
 *
 * @typedef {FinishedMessage | StderrMessage | StdoutMessage | PingMessage} Message
 */

/**
 * Defines internal behavior for interacting with a Pyodide worker.
 *
 * Override abstract methods to handle various message types.
 */
export default class WorkerApi {
  /**
   * @type {Record<number, (message: FinishedMessage) => void>}
   */
  #_callbacks;

  /** @type {Worker} */
  #_worker;

  /** @type {number} */
  #_id;

  /** @type {Uint8Array} */
  #_interruptBuffer;

  /** @type {Promise<FinishedMessage>} */
  #_initPromise;

  constructor() {
    this.#_initializeWorker();
  }

  /**
   * @returns {void}
   */
  #_initializeWorker() {
    this.#_callbacks = {};
    this.#_id = 0;
    this.#_interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
    this.#_worker = new Worker(new URL("./_worker", import.meta.url), {
      type: "classic",
    });
    this.#_worker.onmessage = (event) => this.#_onMessage(event.data);
    this.#_initPromise = this.#_sendMessageAwaitable({
      kind: "init",
      interruptBuffer: this.#_interruptBuffer,
    });
  }

  /**
   * @param {FinishedMessage | PingMessage} message
   * @returns {void}
   */
  #_invokeCallback(message) {
    const id = message.id;
    const onSuccess = this.#_callbacks[id];
    delete this.#_callbacks[id];
    onSuccess(message);
  }

  /**
   * @param {StderrMessage} _message
   * @returns {void}
   */
  onStderr(_message) {}

  /**
   * @param {StdoutMessage} _message
   * @returns {void}
   */
  onStdout(_message) {}

  /**
   * @param {Message} message
   * @returns {void}
   */
  #_onMessage(message) {
    switch (message.kind) {
      case "finished":
      case "ping":
        this.#_invokeCallback(message);
        break;
      case "stderr":
        this.onStderr(message);
        break;
      case "stdout":
        this.onStdout(message);
        break;
    }
  }

  /**
   * @param {any} data
   * @returns {Promise<FinishedMessage>}
   */
  async #_sendMessageAwaitable(data) {
    this.#_id = (this.#_id + 1) % Number.MAX_SAFE_INTEGER;
    return new Promise((onSuccess) => {
      this.#_callbacks[this.#_id] = onSuccess;
      this.#_worker.postMessage({
        id: this.#_id,
        ...data,
      });
    });
  }

  /**
   * @param {string} python
   * @param {string[]} args The arguments to pass to the Python interpreter. This includes the file name
   * @returns {Promise<FinishedMessage>}
   */
  async runPython(python, args = [], syncFs = true) {
    await this.#_initPromise;
    this.#_interruptBuffer[0] = 0;
    return await this.#_sendMessageAwaitable({
      kind: "run",
      python,
      args,
      syncFs,
    });
  }

  /**
   * @returns {Promise<void>}
   */
  async reset() {
    await this.stop();
    this.#_initializeWorker();
  }

  /**
   * @param {number} forceAfterMillis
   * @returns {Promise<void>}
   */
  async stop(forceAfterMillis = 1000) {
    this.#_interruptBuffer[0] = 2;
    // Give the worker a change to finish, force termination if it doesn't and restart worker

    const waitPromise = async () => {
      await new Promise((resolve) => setTimeout(resolve, forceAfterMillis));
      return "force";
    };

    const checkAvailablePromise = async () => {
      await this.#_sendMessageAwaitable({ kind: "ping" });
      return "available";
    };

    const result = await Promise.race([waitPromise(), checkAvailablePromise()]);

    if (result === "force") {
      this.#_worker.terminate();
      this.#_initializeWorker();
    }
  }
}
