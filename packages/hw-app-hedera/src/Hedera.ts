// @flow
import type Transport from "@ledgerhq/hw-transport";
import BIPPath from "bip32-path";
import { UserRefusedOnDevice, UserRefusedAddress } from "@ledgerhq/errors";

const CHUNK_SIZE = 250;
const CLA = 0xe0;

const INS = {
  GET_VERSION: 0x00,
  GET_ADDR: 0x02,
  SIGN: 0x04,
};

const PAYLOAD_TYPE_INIT = 0x00;
const PAYLOAD_TYPE_ADD = 0x01;
const PAYLOAD_TYPE_LAST = 0x02;

const SW_OK = 0x9000;
const SW_CANCEL = 0x6986;

/**
 * Hedera App API
 */
export default class Hedera {
  transport: Transport;

  constructor(transport: Transport, scrambleKey = "BOIL") {
    this.transport = transport;
    transport.decorateAppAPIMethods(
      this,
      ["getAddress", "signTransaction", "getAppConfiguration"],
      scrambleKey
    );
  }

  serializePath(path: Array<number>): Buffer {
    const data = Buffer.alloc(1 + path.length * 4);

    data.writeInt8(path.length, 0);
    path.forEach((segment, index) => {
      data.writeUInt32BE(segment, 1 + index * 4);
    });

    return data;
  }

  foreach<T, A>(
    arr: T[],
    callback: (t: T, n: number) => Promise<A>
  ): Promise<A[]> {
    function iterate(index, array, result) {
      if (index >= array.length) {
        return result;
      } else
        return callback(array[index], index).then(function (res) {
          result.push(res);
          return iterate(index + 1, array, result);
        });
    }
    return Promise.resolve().then(() => iterate(0, arr, []));
  }

  /**
   * Get Hedera address for a given BIP 32 path.
   *
   * @param path a path in BIP 32 format
   * @param display optionally enable or not the display
   * @return an object with a publicKey, address
   * @example
   * const result = await hedera.getAddress("44/3030/0/0/0");
   * const { publicKey, address, returnCode } = result;
   */
  async getAddress(
    path: string,
    display?: boolean
  ): Promise<{
    publicKey: string;
    address: "";
    returnCode: number;
  }> {
    const bipPath = BIPPath.fromString(path).toPathArray();
    const serializedPath = this.serializePath(bipPath);

    const p1 = display ? 0x01 : 0x00;
    const p2 = 0x00;
    const statusList = [SW_OK, SW_CANCEL];

    const response = await this.transport.send(
      CLA,
      INS.GET_ADDR,
      p1,
      p2,
      serializedPath,
      statusList
    );

    const errorCodeData = response.slice(-2);
    const returnCode = errorCodeData[0] * 0x100 + errorCodeData[1];

    if (returnCode === SW_CANCEL) {
      throw new UserRefusedAddress();
    }

    return {
      publicKey: response.toString("hex"),
      address: "", // addresses are not derivable on device
      returnCode,
    };
  }

  /**
   * Sign a Hedera transaction with a given BIP 32 path
   *
   * @param path a path in BIP 32 format
   * @param message a raw hex string representing a serialized transaction.
   * @return an object with signature and returnCode
   */
  async signTransaction(
    path: string,
    message: string
  ): Promise<{ signature: null | Buffer; returnCode: number }> {
    const bipPath = BIPPath.fromString(path).toPathArray();
    const serializedPath = this.serializePath(bipPath);

    const chunks: Buffer[] = [];
    chunks.push(serializedPath);
    const buffer = Buffer.from(message);

    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      let end = i + CHUNK_SIZE;
      if (i > buffer.length) {
        end = buffer.length;
      }
      chunks.push(buffer.slice(i, end));
    }

    let response: Buffer;

    return this.foreach(chunks, (data, j) =>
      this.transport
        .send(
          CLA,
          INS.SIGN,
          j === 0
            ? PAYLOAD_TYPE_INIT
            : j + 1 === chunks.length
            ? PAYLOAD_TYPE_LAST
            : PAYLOAD_TYPE_ADD,
          0,
          data,
          [SW_OK, SW_CANCEL]
        )
        .then((apduResponse) => (response = apduResponse))
    ).then(() => {
      const errorCodeData = response.slice(-2);
      const returnCode = errorCodeData[0] * 0x100 + errorCodeData[1];

      let signature: Buffer | null = null;

      if (response.length > 2) {
        signature = response.slice(0, response.length - 2);
      }

      if (returnCode === SW_CANCEL) {
        throw new UserRefusedOnDevice();
      }

      return {
        signature,
        returnCode,
      };
    });
  }

  /**
   * get the version of the Hedera app installed on the hardware device
   *
   * @return an object with a version
   * @example
   * const result = await hedera.getAppConfiguration();
   *
   * {
   *   "version": "1.0.3"
   * }
   */
  async getAppConfiguration(): Promise<{
    version: string;
  }> {
    const response = await this.transport.send(
      CLA,
      INS.GET_VERSION,
      0x00,
      0x00
    );

    const result = { version: "" };
    result.version = "" + response[1] + "." + response[2] + "." + response[3];
    return result;
  }
}
