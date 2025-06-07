import { MetadataApi } from "@cowprotocol/app-data";

export const getAppData = async () => {
  const appDataDoc = {
    appCode: "CoWFeeModule",
    environment: "prod",
    version: "1.1.0",
    metadata: {},
  };
  const metadataApi = new MetadataApi();
  const { cid, appDataHex, appDataContent } = await metadataApi.getAppDataInfo(
    appDataDoc
  );
  return { cid, appDataHex, appDataContent };
};
