import { withQRSecurity } from "./qr-security.mjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withQRSecurity(nextConfig);
