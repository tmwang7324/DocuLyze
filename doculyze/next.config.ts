import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Raw document bytes ride through the uploadDocument server action as
      // FormData. The default cap is 1MB, which a real PDF blows past — lift it
      // so uploads of moderate files succeed. (Large-file uploads should move to
      // a direct client→Storage signed-URL flow later; see upload design notes.)
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
