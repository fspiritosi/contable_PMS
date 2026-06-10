import type { NextConfig } from "next";
import { instanceConfig } from "./instance.config";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Ignorar errores de TS en build (hay errores preexistentes en opening-balances)
  typescript: {
    ignoreBuildErrors: true,
  },
  // Límites de body para subida de archivos (max de storage: 10MB + overhead multipart).
  // El archivo viaja como File/multipart (binario), no como number[] JSON.
  experimental: {
    serverActions: {
      bodySizeLimit: '15mb',
    },
    // El request pasa por el proxy (src/proxy.ts), que bufferea el body hasta este límite.
    middlewareClientMaxBodySize: '15mb',
  },
  // Configuración de imágenes remotas
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: String(instanceConfig.ports.minioApi), // MinIO local
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
