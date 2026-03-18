declare module "@ffmpeg-installer/ffmpeg" {
  interface FfmpegInstallerBinary {
    path: string;
    version: string;
    url: string;
  }

  const ffmpegInstaller: FfmpegInstallerBinary;
  export = ffmpegInstaller;
}
