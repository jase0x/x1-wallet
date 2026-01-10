var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const deserializers = {};
const addCustomErrorDeserializer = (name, deserializer) => {
  deserializers[name] = deserializer;
};
const createCustomErrorClass = (name) => {
  class CustomErrorClass extends Error {
    constructor(message, fields, options) {
      super(message || name, options);
      __publicField(this, "cause");
      Object.setPrototypeOf(this, CustomErrorClass.prototype);
      this.name = name;
      if (fields) {
        for (const k in fields) {
          this[k] = fields[k];
        }
      }
      if (options && isObject(options) && "cause" in options && !this.cause) {
        const cause = options.cause;
        this.cause = cause;
        if ("stack" in cause) {
          this.stack = this.stack + "\nCAUSE: " + cause.stack;
        }
      }
    }
  }
  return CustomErrorClass;
};
function isObject(value) {
  return typeof value === "object";
}
const DisconnectedDevice = createCustomErrorClass("DisconnectedDevice");
const DisconnectedDeviceDuringOperation = createCustomErrorClass("DisconnectedDeviceDuringOperation");
const TransportOpenUserCancelled = createCustomErrorClass("TransportOpenUserCancelled");
const TransportInterfaceNotAvailable = createCustomErrorClass("TransportInterfaceNotAvailable");
const TransportRaceCondition = createCustomErrorClass("TransportRaceCondition");
const TransportWebUSBGestureRequired = createCustomErrorClass("TransportWebUSBGestureRequired");
var HwTransportErrorType;
(function(HwTransportErrorType2) {
  HwTransportErrorType2["Unknown"] = "Unknown";
  HwTransportErrorType2["LocationServicesDisabled"] = "LocationServicesDisabled";
  HwTransportErrorType2["LocationServicesUnauthorized"] = "LocationServicesUnauthorized";
  HwTransportErrorType2["BluetoothScanStartFailed"] = "BluetoothScanStartFailed";
})(HwTransportErrorType || (HwTransportErrorType = {}));
class TransportError extends Error {
  constructor(message, id) {
    const name = "TransportError";
    super(message || name);
    __publicField(this, "id");
    this.name = name;
    this.message = message;
    this.stack = new Error(message).stack;
    this.id = id;
  }
}
addCustomErrorDeserializer("TransportError", (e) => new TransportError(e.message, e.id));
const StatusCodes = {
  ACCESS_CONDITION_NOT_FULFILLED: 38916,
  ALGORITHM_NOT_SUPPORTED: 38020,
  CLA_NOT_SUPPORTED: 28160,
  CODE_BLOCKED: 38976,
  CODE_NOT_INITIALIZED: 38914,
  COMMAND_INCOMPATIBLE_FILE_STRUCTURE: 27009,
  CONDITIONS_OF_USE_NOT_SATISFIED: 27013,
  CONTRADICTION_INVALIDATION: 38928,
  CONTRADICTION_SECRET_CODE_STATUS: 38920,
  DEVICE_IN_RECOVERY_MODE: 26159,
  CUSTOM_IMAGE_EMPTY: 26158,
  FILE_ALREADY_EXISTS: 27273,
  FILE_NOT_FOUND: 37892,
  GP_AUTH_FAILED: 25344,
  HALTED: 28586,
  INCONSISTENT_FILE: 37896,
  INCORRECT_DATA: 27264,
  INCORRECT_LENGTH: 26368,
  INCORRECT_P1_P2: 27392,
  INS_NOT_SUPPORTED: 27904,
  DEVICE_NOT_ONBOARDED: 27911,
  DEVICE_NOT_ONBOARDED_2: 26129,
  INVALID_KCV: 38021,
  INVALID_OFFSET: 37890,
  LICENSING: 28482,
  LOCKED_DEVICE: 21781,
  MAX_VALUE_REACHED: 38992,
  MEMORY_PROBLEM: 37440,
  MISSING_CRITICAL_PARAMETER: 26624,
  NO_EF_SELECTED: 37888,
  NOT_ENOUGH_MEMORY_SPACE: 27268,
  OK: 36864,
  PIN_REMAINING_ATTEMPTS: 25536,
  REFERENCED_DATA_NOT_FOUND: 27272,
  SECURITY_STATUS_NOT_SATISFIED: 27010,
  TECHNICAL_PROBLEM: 28416,
  UNKNOWN_APDU: 27906,
  USER_REFUSED_ON_DEVICE: 21761,
  NOT_ENOUGH_SPACE: 20738,
  APP_NOT_FOUND_OR_INVALID_CONTEXT: 20771,
  INVALID_APP_NAME_LENGTH: 26378,
  GEN_AES_KEY_FAILED: 21529,
  INTERNAL_CRYPTO_OPERATION_FAILED: 21530,
  INTERNAL_COMPUTE_AES_CMAC_FAILED: 21531,
  ENCRYPT_APP_STORAGE_FAILED: 21532,
  INVALID_BACKUP_STATE: 26178,
  PIN_NOT_SET: 21762,
  INVALID_BACKUP_LENGTH: 26419,
  INVALID_RESTORE_STATE: 26179,
  INVALID_CHUNK_LENGTH: 26420,
  INVALID_BACKUP_HEADER: 26698,
  // Not documented:
  TRUSTCHAIN_WRONG_SEED: 45063
};
function getAltStatusMessage(code) {
  switch (code) {
    case 26368:
      return "Incorrect length";
    case 26624:
      return "Missing critical parameter";
    case 27010:
      return "Security not satisfied (dongle locked or have invalid access rights)";
    case 27013:
      return "Condition of use not satisfied (denied by the user?)";
    case 27264:
      return "Invalid data received";
    case 27392:
      return "Invalid parameter received";
    case 21781:
      return "Locked device";
  }
  if (28416 <= code && code <= 28671) {
    return "Internal error, please report";
  }
}
class TransportStatusError extends Error {
  /**
   * @param statusCode The error status code coming from a Transport implementation
   * @param options containing:
   *  - canBeMappedToChildError: enable the mapping of TransportStatusError to an error extending/inheriting from it
   *  . Ex: LockedDeviceError. Default to true.
   */
  constructor(statusCode, { canBeMappedToChildError = true } = {}) {
    const statusText = Object.keys(StatusCodes).find((k) => StatusCodes[k] === statusCode) || "UNKNOWN_ERROR";
    const smsg = getAltStatusMessage(statusCode) || statusText;
    const statusCodeStr = statusCode.toString(16);
    const message = `Ledger device: ${smsg} (0x${statusCodeStr})`;
    super(message);
    __publicField(this, "statusCode");
    __publicField(this, "statusText");
    this.name = "TransportStatusError";
    this.statusCode = statusCode;
    this.statusText = statusText;
    Object.setPrototypeOf(this, TransportStatusError.prototype);
    if (canBeMappedToChildError && statusCode === StatusCodes.LOCKED_DEVICE) {
      return new LockedDeviceError(message);
    }
  }
}
class LockedDeviceError extends TransportStatusError {
  constructor(message) {
    super(StatusCodes.LOCKED_DEVICE, { canBeMappedToChildError: false });
    if (message) {
      this.message = message;
    }
    this.name = "LockedDeviceError";
    Object.setPrototypeOf(this, LockedDeviceError.prototype);
  }
}
addCustomErrorDeserializer("TransportStatusError", (e) => new TransportStatusError(e.statusCode));
export {
  DisconnectedDeviceDuringOperation as D,
  StatusCodes as S,
  TransportOpenUserCancelled as T,
  TransportError as a,
  DisconnectedDevice as b,
  TransportWebUSBGestureRequired as c,
  TransportInterfaceNotAvailable as d,
  TransportStatusError as e,
  TransportRaceCondition as f
};
