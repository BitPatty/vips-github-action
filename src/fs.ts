import { Stats } from 'fs';
import { stat } from 'fs/promises';
import { file as initTmpFile } from 'tmp';

export class FS {
  /**
   * Gets the stats of the specified file
   *
   * @param filePath  The file path
   * @returns         The file stats
   */
  public static getFileStats(filePath: string): Promise<Stats> {
    return stat(filePath);
  }

  /**
   * Creates a file in the default tmp directory
   *
   * @param postfix  The postfix for the file name (must include file
   *                 extension, includeing the leading .)
   * @returns        The absolute path to the created file
   */
  public static initializeEmptyTempFile(postfix: string): Promise<string> {
    return new Promise((resolve, reject) =>
      initTmpFile(
        {
          // Restrict access to file owner (aka this process)
          mode: 0o600,

          // The filename postfix
          postfix,

          // Close the file descriptor
          // after the file is created
          discardDescriptor: true,
        },
        (outerError: Error, path: string) => {
          if (outerError) {
            console.error(outerError);
            reject(outerError);
          } else {
            try {
              resolve(path);
            } catch (innerError) {
              console.error(innerError);
              reject(innerError);
            }
          }
        },
      ),
    );
  }
}
