/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdf-to-img (and its pdfjs dependency) must run as a real Node package,
    // not be bundled into the server build.
    serverComponentsExternalPackages: ["pdf-to-img", "@react-pdf/renderer"],
    // Uploads go through server actions, which Next caps at 1 MB by default.
    // Room for a submission of several phone photos (15 MB/file in
    // actions/submissions.ts) or an exam PDF (25 MB in pdf-processing.ts).
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
