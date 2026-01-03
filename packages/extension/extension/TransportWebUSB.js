var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { b as ledgerUSBVendorId, T as Transport, i as identifyUSBProductId, l as log } from "./index.js";
import { c as createHIDframing } from "./hid-framing.js";
import { c as TransportWebUSBGestureRequired, a as TransportOpenUserCancelled, d as TransportInterfaceNotAvailable, b as DisconnectedDeviceDuringOperation, D as DisconnectedDevice } from "./index2.js";
import "./popup.js";
const ledgerDevices = [
  {
    vendorId: ledgerUSBVendorId
  }
];
async function requestLedgerDevice() {
  const device = await navigator.usb.requestDevice({
    filters: ledgerDevices
  });
  return device;
}
async function getLedgerDevices() {
  const devices = await navigator.usb.getDevices();
  return devices.filter((d) => d.vendorId === ledgerUSBVendorId);
}
async function getFirstLedgerDevice() {
  const existingDevices = await getLedgerDevices();
  if (existingDevices.length > 0)
    return existingDevices[0];
  return requestLedgerDevice();
}
const isSupported = () => Promise.resolve(!!navigator && !!navigator.usb && typeof navigator.usb.getDevices === "function");
const configurationValue = 1;
const endpointNumber = 3;
const _TransportWebUSB = class _TransportWebUSB extends Transport {
  constructor(device, interfaceNumber) {
    super();
    __publicField(this, "device");
    __publicField(this, "deviceModel");
    __publicField(this, "channel", Math.floor(Math.random() * 65535));
    __publicField(this, "packetSize", 64);
    __publicField(this, "interfaceNumber");
    __publicField(this, "_disconnectEmitted", false);
    __publicField(this, "_emitDisconnect", (e) => {
      if (this._disconnectEmitted)
        return;
      this._disconnectEmitted = true;
      this.emit("disconnect", e);
    });
    this.device = device;
    this.interfaceNumber = interfaceNumber;
    this.deviceModel = identifyUSBProductId(device.productId);
  }
  /**
   * Similar to create() except it will always display the device permission (even if some devices are already accepted).
   */
  static async request() {
    const device = await requestLedgerDevice();
    return _TransportWebUSB.open(device);
  }
  /**
   * Similar to create() except it will never display the device permission (it returns a Promise<?Transport>, null if it fails to find a device).
   */
  static async openConnected() {
    const devices = await getLedgerDevices();
    if (devices.length === 0)
      return null;
    return _TransportWebUSB.open(devices[0]);
  }
  /**
   * Create a Ledger transport with a USBDevice
   */
  static async open(device) {
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(configurationValue);
    }
    await gracefullyResetDevice(device);
    const iface = device.configurations[0].interfaces.find(({ alternates }) => alternates.some((a) => a.interfaceClass === 255));
    if (!iface) {
      throw new TransportInterfaceNotAvailable("No WebUSB interface found for your Ledger device. Please upgrade firmware or contact techsupport.");
    }
    const interfaceNumber = iface.interfaceNumber;
    try {
      await device.claimInterface(interfaceNumber);
    } catch (e) {
      await device.close();
      throw new TransportInterfaceNotAvailable(e.message);
    }
    const transport = new _TransportWebUSB(device, interfaceNumber);
    const onDisconnect = (e) => {
      if (device === e.device) {
        navigator.usb.removeEventListener("disconnect", onDisconnect);
        transport._emitDisconnect(new DisconnectedDevice());
      }
    };
    navigator.usb.addEventListener("disconnect", onDisconnect);
    return transport;
  }
  /**
   * Release the transport device
   */
  async close() {
    await this.exchangeBusyPromise;
    await this.device.releaseInterface(this.interfaceNumber);
    await gracefullyResetDevice(this.device);
    await this.device.close();
  }
  /**
   * Exchange with the device using APDU protocol.
   * @param apdu
   * @returns a promise of apdu response
   */
  async exchange(apdu) {
    const b = await this.exchangeAtomicImpl(async () => {
      const { channel, packetSize } = this;
      log("apdu", "=> " + apdu.toString("hex"));
      const framing = createHIDframing(channel, packetSize);
      const blocks = framing.makeBlocks(apdu);
      for (let i = 0; i < blocks.length; i++) {
        await this.device.transferOut(endpointNumber, blocks[i]);
      }
      let result;
      let acc;
      while (!(result = framing.getReducedResult(acc))) {
        const r = await this.device.transferIn(endpointNumber, packetSize);
        const buffer = Buffer.from(r.data.buffer);
        acc = framing.reduceResponse(acc, buffer);
      }
      log("apdu", "<= " + result.toString("hex"));
      return result;
    }).catch((e) => {
      if (e && e.message && e.message.includes("disconnected")) {
        this._emitDisconnect(e);
        throw new DisconnectedDeviceDuringOperation(e.message);
      }
      throw e;
    });
    return b;
  }
  setScrambleKey() {
  }
};
/**
 * Check if WebUSB transport is supported.
 */
__publicField(_TransportWebUSB, "isSupported", isSupported);
/**
 * List the WebUSB devices that was previously authorized by the user.
 */
__publicField(_TransportWebUSB, "list", getLedgerDevices);
/**
 * Actively listen to WebUSB devices and emit ONE device
 * that was either accepted before, if not it will trigger the native permission UI.
 *
 * Important: it must be called in the context of a UI click!
 */
__publicField(_TransportWebUSB, "listen", (observer) => {
  let unsubscribed = false;
  getFirstLedgerDevice().then((device) => {
    if (!unsubscribed) {
      const deviceModel = identifyUSBProductId(device.productId);
      observer.next({
        type: "add",
        descriptor: device,
        deviceModel
      });
      observer.complete();
    }
  }, (error) => {
    if (window.DOMException && error instanceof window.DOMException && error.code === 18) {
      observer.error(new TransportWebUSBGestureRequired(error.message));
    } else {
      observer.error(new TransportOpenUserCancelled(error.message));
    }
  });
  function unsubscribe() {
    unsubscribed = true;
  }
  return {
    unsubscribe
  };
});
let TransportWebUSB = _TransportWebUSB;
async function gracefullyResetDevice(device) {
  try {
    await device.reset();
  } catch (err) {
    console.warn(err);
  }
}
export {
  TransportWebUSB as default
};
