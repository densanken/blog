import { prepareUnicodeTables } from "../../../plugins/unicode-tables.ts";

export default async () => {
  delete process.env.UNICODE_DATA_DIR;
  await prepareUnicodeTables();
};
