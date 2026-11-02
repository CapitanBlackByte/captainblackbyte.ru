import { buildShipCloud } from "./ship-cloud.js";

self.onmessage = async ({ data }) => {
  try {
    const response = await fetch(data.url);
    const bitmap = await createImageBitmap(await response.blob());
    const cloud = buildShipCloud(bitmap, data.density);
    self.postMessage(cloud, [cloud.data.buffer]);
  } catch (error) {
    self.postMessage({ failed: String(error) });
  }
};
