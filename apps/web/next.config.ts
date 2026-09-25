import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF.js worker is read at runtime by src/app/pdf-worker/route.ts, which
  // serves it with a correct JavaScript MIME type. It is loaded by path rather
  // than imported, so it has to be listed here or the deployment bundle would
  // leave it behind.
  outputFileTracingIncludes: {
    "/pdf-worker": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"],
  },

  // One address for the whole site. Visitors and search engines that arrive on
  // www.diffnexa.com are sent permanently to the same page on diffnexa.com, so
  // Google indexes a single copy of each page instead of two.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.diffnexa.com" }],
        destination: "https://diffnexa.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
