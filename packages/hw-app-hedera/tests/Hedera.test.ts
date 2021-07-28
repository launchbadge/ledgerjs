import {
  openTransportReplayer,
  RecordStore,
} from "@ledgerhq/hw-transport-mocker";
import Hedera from "../src/Hedera";

test("Hedera init", async () => {
  const transport = await openTransportReplayer(RecordStore.fromString(""));
  const hedera = new Hedera(transport);
  expect(hedera).not.toBe(undefined);
});
