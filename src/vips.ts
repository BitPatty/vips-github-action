import { spawn } from 'child_process';
import { extname } from 'path';
import { FS } from './fs.js';

type VIPSConfig = {
  quality: number;
  stripMetadata: boolean;
  pngCompressionLevel: number;
  jpegProgressive: boolean;
};

type SupportedExtension = `.${'png' | 'jpeg' | 'jpg'}`;

export class VIPS {
  readonly #placeholderIn = '{{in}}';
  readonly #placeholderOut = '{{out}}';

  /**
   * Compresses the image and stores the result in a new
   * flie
   *
   * @param imagePath  The source image path
   * @param config     The compression options
   * @returns          The absolute path to the resulting file
   */
  public async compress(
    imagePath: string,
    config: VIPSConfig,
  ): Promise<string> {
    const extension = extname(imagePath);
    const outFile = await FS.initializeEmptyTempFile(extension);

    const args = this.#vipsArgs(extension, config)
      .replace(this.#placeholderIn, this.#quotePath(imagePath))
      .replace(this.#placeholderOut, this.#quotePath(outFile));

    const childProcess = spawn('vips', [args], {
      shell: true,
      timeout: 10000, // 10 seconds
    });

    await new Promise<void>((resolve, reject) => {
      childProcess.stdout.on('data', (c) => console.debug(`${c}`));
      childProcess.stderr.on('data', (c) => console.error(`${c}`));
      childProcess.on('close', (c) => {
        console.log(`Process exited with code: ${c}`);
        if (c !== 0) reject(c);
        else resolve();
      });
    });

    return outFile;
  }

  /**
   * Gets the vips arguments necessary to compress a file
   *
   * The IN and OUT file parameters are mapped to the placeholders
   *
   * @param extension  The file extension, used to determine the
   *                   file format
   * @param config     The compression configuration
   * @returns          The vips arguments
   */
  #vipsArgs(extension: string, config: VIPSConfig): string {
    const normalizedExtension = extension.toLowerCase() as SupportedExtension;
    switch (normalizedExtension) {
      case '.png':
        return [
          'pngsave',
          this.#placeholderIn,
          this.#placeholderOut,
          `--compression=${config.pngCompressionLevel}`,
          `--Q=${config.quality}`,
          config.stripMetadata ? '--strip=1' : '',
          '--interlace=true',
          '--palette=true',
        ].join(' ');
      case '.jpeg':
      case '.jpg':
        return [
          'jpegsave',
          this.#placeholderIn,
          this.#placeholderOut,
          `--Q=${config.quality}`,
          config.jpegProgressive ? '--interlace=1' : '',
          config.stripMetadata ? '--strip=1' : '',
        ].join(' ');
      default:
        throw new Error(`Unsupported format: ${normalizedExtension}`);
    }
  }

  /**
   * Quotes a file path for use in shell commands
   *
   * @param path  The file path
   * @returns     The quoted file path
   */
  #quotePath(path: string): string {
    return `'${path.replace(/'/g, "'\\''")}'`;
  }
}
