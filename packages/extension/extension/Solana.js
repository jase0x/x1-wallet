var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { S as StatusCodes } from "./index3.js";
import { g as getDefaultExportFromCjs } from "./popup.js";
const HARDENED = 2147483648;
var BIPPath = function(path) {
  if (!Array.isArray(path)) {
    throw new Error("Input must be an Array");
  }
  if (path.length === 0) {
    throw new Error("Path must contain at least one level");
  }
  for (var i = 0; i < path.length; i++) {
    if (typeof path[i] !== "number") {
      throw new Error("Path element is not a number");
    }
  }
  this.path = path;
};
BIPPath.validatePathArray = function(path) {
  try {
    BIPPath.fromPathArray(path);
    return true;
  } catch (e) {
    return false;
  }
};
BIPPath.validateString = function(text, reqRoot) {
  try {
    BIPPath.fromString(text, reqRoot);
    return true;
  } catch (e) {
    return false;
  }
};
BIPPath.fromPathArray = function(path) {
  return new BIPPath(path);
};
BIPPath.fromString = function(text, reqRoot) {
  if (/^m\//i.test(text)) {
    text = text.slice(2);
  } else if (reqRoot) {
    throw new Error("Root element is required");
  }
  var path = text.split("/");
  var ret = new Array(path.length);
  for (var i = 0; i < path.length; i++) {
    var tmp = /(\d+)([hH\']?)/.exec(path[i]);
    if (tmp === null) {
      throw new Error("Invalid input");
    }
    ret[i] = parseInt(tmp[1], 10);
    if (ret[i] >= HARDENED) {
      throw new Error("Invalid child index");
    }
    if (tmp[2] === "h" || tmp[2] === "H" || tmp[2] === "'") {
      ret[i] += HARDENED;
    } else if (tmp[2].length != 0) {
      throw new Error("Invalid modifier");
    }
  }
  return new BIPPath(ret);
};
BIPPath.prototype.toPathArray = function() {
  return this.path;
};
BIPPath.prototype.toString = function(noRoot, oldStyle) {
  var ret = new Array(this.path.length);
  for (var i = 0; i < this.path.length; i++) {
    var tmp = this.path[i];
    if (tmp & HARDENED) {
      ret[i] = (tmp & ~HARDENED) + (oldStyle ? "h" : "'");
    } else {
      ret[i] = tmp;
    }
  }
  return (noRoot ? "" : "m/") + ret.join("/");
};
BIPPath.prototype.inspect = function() {
  return "BIPPath <" + this.toString() + ">";
};
var bip32Path = BIPPath;
const BIPPath$1 = /* @__PURE__ */ getDefaultExportFromCjs(bip32Path);
function buildTLV(tag, value) {
  const length = value.length;
  if (length > 255) {
    throw new Error("Value length exceeds 255 bytes");
  }
  return Buffer.concat([tag, new Uint8Array([length]), value]);
}
function buildDescriptor({ data, signature }) {
  const SIGNATURE_TAG = Buffer.from(new Uint8Array([8]));
  return Buffer.concat([data, buildTLV(SIGNATURE_TAG, signature)]);
}
const P1_NON_CONFIRM = 0;
const P1_CONFIRM = 1;
const P2_INIT = 0;
const P2_EXTEND = 1;
const P2_MORE = 2;
const P2_USER_INPUT_ATA = 8;
const MAX_PAYLOAD = 255;
const LEDGER_CLA = 224;
const INS = {
  GET_VERSION: 4,
  GET_ADDR: 5,
  SIGN: 6,
  SIGN_OFFCHAIN: 7,
  GET_CHALLENGE: 32,
  PROVIDE_TRUSTED_NAME: 33,
  PROVIDE_TRUSTED_DYNAMIC_DESCRIPTOR: 34
};
var EXTRA_STATUS_CODES;
(function(EXTRA_STATUS_CODES2) {
  EXTRA_STATUS_CODES2[EXTRA_STATUS_CODES2["BLIND_SIGNATURE_REQUIRED"] = 26632] = "BLIND_SIGNATURE_REQUIRED";
})(EXTRA_STATUS_CODES || (EXTRA_STATUS_CODES = {}));
class Solana {
  constructor(transport, scrambleKey = "solana_default_scramble_key") {
    __publicField(this, "transport");
    this.transport = transport;
    this.transport.decorateAppAPIMethods(this, [
      "getAddress",
      "signTransaction",
      "getAppConfiguration",
      "getChallenge",
      "provideTrustedName",
      "provideTrustedDynamicDescriptor"
    ], scrambleKey);
  }
  /**
   * Get Solana address (public key) for a BIP32 path.
   *
   * Because Solana uses Ed25519 keypairs, as per SLIP-0010
   * all derivation-path indexes will be promoted to hardened indexes.
   *
   * @param path a BIP32 path
   * @param display flag to show display
   * @returns an object with the address field
   *
   * @example
   * solana.getAddress("44'/501'/0'").then(r => r.address)
   */
  async getAddress(path, display = false) {
    const pathBuffer = this.pathToBuffer(path);
    const addressBuffer = await this.sendToDevice(INS.GET_ADDR, display ? P1_CONFIRM : P1_NON_CONFIRM, pathBuffer);
    return {
      address: addressBuffer
    };
  }
  /**
   * Provides trusted dynamic and signed coin metadata
   *
   * @param data An object containing the descriptor and its signature from the CAL
   */
  async provideTrustedDynamicDescriptor(data) {
    await this.sendToDevice(INS.PROVIDE_TRUSTED_DYNAMIC_DESCRIPTOR, P1_NON_CONFIRM, buildDescriptor(data));
    return true;
  }
  /**
   * Sign a Solana transaction.
   *
   * @param path a BIP32 path
   * @param txBuffer serialized transaction
   * @param userInputType optional user input type (ata or sol, for the case of token transfers)
   *
   * @returns an object with the signature field
   *
   * @example
   * solana.signTransaction("44'/501'/0'", txBuffer).then(r => r.signature)
   */
  async signTransaction(path, txBuffer, userInputType) {
    const pathBuffer = this.pathToBuffer(path);
    const pathsCountBuffer = Buffer.alloc(1);
    pathsCountBuffer.writeUInt8(1, 0);
    const payload = Buffer.concat([pathsCountBuffer, pathBuffer, txBuffer]);
    const p2Flag = userInputType === "ata" ? P2_USER_INPUT_ATA : void 0;
    const signatureBuffer = await this.sendToDevice(INS.SIGN, P1_CONFIRM, payload, p2Flag);
    return {
      signature: signatureBuffer
    };
  }
  /**
   * Sign a Solana off-chain message.
   *
   * @param path a BIP32 path
   * @param msgBuffer serialized off-chain message
   *
   * @returns an object with the signature field
   *
   * @example
   * solana.signOffchainMessage("44'/501'/0'", msgBuffer).then(r => r.signature)
   */
  async signOffchainMessage(path, msgBuffer) {
    const pathBuffer = this.pathToBuffer(path);
    const pathsCountBuffer = Buffer.alloc(1);
    pathsCountBuffer.writeUInt8(1, 0);
    const payload = Buffer.concat([pathsCountBuffer, pathBuffer, msgBuffer]);
    const signatureBuffer = await this.sendToDevice(INS.SIGN_OFFCHAIN, P1_CONFIRM, payload);
    return {
      signature: signatureBuffer
    };
  }
  /**
   * Get application configuration.
   *
   * @returns application config object
   *
   * @example
   * solana.getAppConfiguration().then(r => r.version)
   */
  async getAppConfiguration() {
    const [blindSigningEnabled, pubKeyDisplayMode, major, minor, patch] = await this.sendToDevice(INS.GET_VERSION, P1_NON_CONFIRM, Buffer.alloc(0));
    return {
      blindSigningEnabled: Boolean(blindSigningEnabled),
      pubKeyDisplayMode,
      version: `${major}.${minor}.${patch}`
    };
  }
  /**
   * Method returning a 4 bytes TLV challenge as an hex string
   *
   * @returns {Promise<string>}
   */
  async getChallenge() {
    return this.transport.send(LEDGER_CLA, INS.GET_CHALLENGE, P1_NON_CONFIRM, P2_INIT).then((res) => {
      const data = res.toString("hex");
      const fourBytesChallenge = data.slice(0, -4);
      const statusCode = data.slice(-4);
      if (statusCode !== "9000") {
        throw new Error(`An error happened while generating the challenge. Status code: ${statusCode}`);
      }
      return `0x${fourBytesChallenge}`;
    });
  }
  /**
   * Provides a trusted name to be displayed during transactions in place of the token address it is associated to. It shall be run just before a transaction involving the associated address that would be displayed on the device.
   *
   * @param data a stringified buffer of some TLV encoded data to represent the trusted name
   * @returns a boolean
   */
  async provideTrustedName(data) {
    await this.transport.send(LEDGER_CLA, INS.PROVIDE_TRUSTED_NAME, P1_NON_CONFIRM, P2_INIT, Buffer.from(data, "hex"));
    return true;
  }
  pathToBuffer(originalPath) {
    const path = originalPath.split("/").map((value) => value.endsWith("'") || value.endsWith("h") ? value : value + "'").join("/");
    const pathNums = BIPPath$1.fromString(path).toPathArray();
    return this.serializePath(pathNums);
  }
  serializePath(path) {
    const buf = Buffer.alloc(1 + path.length * 4);
    buf.writeUInt8(path.length, 0);
    for (const [i, num] of path.entries()) {
      buf.writeUInt32BE(num, 1 + i * 4);
    }
    return buf;
  }
  // send chunked if payload size exceeds maximum for a call
  async sendToDevice(instruction, p1, payload, p2 = P2_INIT) {
    const acceptStatusList = [StatusCodes.OK, EXTRA_STATUS_CODES.BLIND_SIGNATURE_REQUIRED];
    let payload_offset = 0;
    if (payload.length > MAX_PAYLOAD) {
      while (payload.length - payload_offset > MAX_PAYLOAD) {
        const buf2 = payload.slice(payload_offset, payload_offset + MAX_PAYLOAD);
        payload_offset += MAX_PAYLOAD;
        const reply2 = await this.transport.send(LEDGER_CLA, instruction, p1, p2 | P2_MORE, buf2, acceptStatusList);
        this.throwOnFailure(reply2);
        p2 |= P2_EXTEND;
      }
    }
    const buf = payload.slice(payload_offset);
    const reply = await this.transport.send(LEDGER_CLA, instruction, p1, p2, buf, acceptStatusList);
    this.throwOnFailure(reply);
    return reply.slice(0, reply.length - 2);
  }
  throwOnFailure(reply) {
    const status = reply.readUInt16BE(reply.length - 2);
    switch (status) {
      case EXTRA_STATUS_CODES.BLIND_SIGNATURE_REQUIRED:
        throw new Error("Missing a parameter. Try enabling blind signature in the app");
      default:
        return;
    }
  }
}
var PubKeyDisplayMode;
(function(PubKeyDisplayMode2) {
  PubKeyDisplayMode2[PubKeyDisplayMode2["LONG"] = 0] = "LONG";
  PubKeyDisplayMode2[PubKeyDisplayMode2["SHORT"] = 1] = "SHORT";
})(PubKeyDisplayMode || (PubKeyDisplayMode = {}));
export {
  Solana as default
};
