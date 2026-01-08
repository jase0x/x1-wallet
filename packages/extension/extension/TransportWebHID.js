var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { T as Transport, i as identifyUSBProductId, l as log, a as ledgerUSBVendorId } from "./index.js";
import { c as createHIDframing } from "./hid-framing.js";
import { T as TransportOpenUserCancelled, a as TransportError, D as DisconnectedDeviceDuringOperation, b as DisconnectedDevice } from "./index2.js";
import "./popup.js";
const ledgerDevices = [
  {
    vendorId: ledgerUSBVendorId
  }
];
const isSupported = () => Promise.resolve(!!(window.navigator && window.navigator.hid));
const getHID = () => {
  const { hid } = navigator;
  if (!hid)
    throw new TransportError("navigator.hid is not supported", "HIDNotSupported");
  return hid;
};
async function requestLedgerDevices() {
  const device = await getHID().requestDevice({
    filters: ledgerDevices
  });
  if (Array.isArray(device))
    return device;
  return [device];
}
async function getLedgerDevices() {
  const devices = await getHID().getDevices();
  return devices.filter((d) => d.vendorId === ledgerUSBVendorId);
}
async function getFirstLedgerDevice() {
  const existingDevices = await getLedgerDevices();
  if (existingDevices.length > 0)
    return existingDevices[0];
  const devices = await requestLedgerDevices();
  return devices[0];
}
const _TransportWebHID = class _TransportWebHID extends Transport {
  constructor(device) {
    super();
    __publicField(this, "device");
    __publicField(this, "deviceModel");
    __publicField(this, "channel", Math.floor(Math.random() * 65535));
    __publicField(this, "packetSize", 64);
    __publicField(this, "inputs", []);
    __publicField(this, "inputCallback");
    __publicField(this, "read", () => {
      if (this.inputs.length) {
        return Promise.resolve(this.inputs.shift());
      }
      return new Promise((success) => {
        this.inputCallback = success;
      });
    });
    __publicField(this, "onInputReport", (e) => {
      const buffer = Buffer.from(e.data.buffer);
      if (this.inputCallback) {
        this.inputCallback(buffer);
        this.inputCallback = null;
      } else {
        this.inputs.push(buffer);
      }
    });
    __publicField(this, "_disconnectEmitted", false);
    __publicField(this, "_emitDisconnect", (e) => {
      if (this._disconnectEmitted)
        return;
      this._disconnectEmitted = true;
      this.emit("disconnect", e);
    });
    /**
     * Exchange with the device using APDU protocol.
     * @param apdu
     * @returns a promise of apdu response
     */
    __publicField(this, "exchange", async (apdu) => {
      const b = await this.exchangeAtomicImpl(async () => {
        const { channel, packetSize } = this;
        log("apdu", "=> " + apdu.toString("hex"));
        const framing = createHIDframing(channel, packetSize);
        const blocks = framing.makeBlocks(apdu);
        for (let i = 0; i < blocks.length; i++) {
          await this.device.sendReport(0, blocks[i]);
        }
        let result;
        let acc;
        while (!(result = framing.getReducedResult(acc))) {
          try {
            const buffer = await this.read();
            acc = framing.reduceResponse(acc, buffer);
          } catch (e) {
            if (e instanceof TransportError && e.id === "InvalidChannel") {
              continue;
            }
            throw e;
          }
        }
        log("apdu", "<= " + result.toString("hex"));
        return result;
      }).catch((e) => {
        if (e && e.message && e.message.includes("write")) {
          this._emitDisconnect(e);
          throw new DisconnectedDeviceDuringOperation(e.message);
        }
        throw e;
      });
      return b;
    });
    this.device = device;
    this.deviceModel = typeof device.productId === "number" ? identifyUSBProductId(device.productId) : void 0;
    device.addEventListener("inputreport", this.onInputReport);
  }
  /**
   * Similar to create() except it will always display the device permission (even if some devices are already accepted).
   */
  static async request() {
    const [device] = await requestLedgerDevices();
    return _TransportWebHID.open(device);
  }
  /**
   * Similar to create() except it will never display the device permission (it returns a Promise<?Transport>, null if it fails to find a device).
   */
  static async openConnected() {
    const devices = await getLedgerDevices();
    if (devices.length === 0)
      return null;
    return _TransportWebHID.open(devices[0]);
  }
  /**
   * Create a Ledger transport with a HIDDevice
   */
  static async open(device) {
    await device.open();
    const transport = new _TransportWebHID(device);
    const onDisconnect = (e) => {
      if (device === e.device) {
        getHID().removeEventListener("disconnect", onDisconnect);
        transport._emitDisconnect(new DisconnectedDevice());
      }
    };
    getHID().addEventListener("disconnect", onDisconnect);
    return transport;
  }
  /**
   * Release the transport device
   */
  async close() {
    await this.exchangeBusyPromise;
    this.device.removeEventListener("inputreport", this.onInputReport);
    await this.device.close();
  }
  setScrambleKey() {
  }
};
/**
 * Check if WebUSB transport is supported.
 */
__publicField(_TransportWebHID, "isSupported", isSupported);
/**
 * List the WebUSB devices that was previously authorized by the user.
 */
__publicField(_TransportWebHID, "list", getLedgerDevices);
/**
 * Actively listen to WebUSB devices and emit ONE device
 * that was either accepted before, if not it will trigger the native permission UI.
 *
 * Important: it must be called in the context of a UI click!
 */
__publicField(_TransportWebHID, "listen", (observer) => {
  let unsubscribed = false;
  getFirstLedgerDevice().then((device) => {
    if (!device) {
      observer.error(new TransportOpenUserCancelled("Access denied to use Ledger device"));
    } else if (!unsubscribed) {
      const deviceModel = typeof device.productId === "number" ? identifyUSBProductId(device.productId) : void 0;
      observer.next({
        type: "add",
        descriptor: device,
        deviceModel
      });
      observer.complete();
    }
  }, (error) => {
    observer.error(new TransportOpenUserCancelled(error.message));
  });
  function unsubscribe() {
    unsubscribed = true;
  }
  return {
    unsubscribe
  };
});
let TransportWebHID = _TransportWebHID;
export {
  TransportWebHID as default
};
