/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdf-to-img (and its pdfjs dependency) must run as a real Node package,
    // not be bundled into the server build.
    serverComponentsExternalPackages: ["pdf-to-img", "@react-pdf/renderer"],
  },
};

export default nextConfig;
