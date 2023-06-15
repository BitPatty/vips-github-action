import { spawn } from 'child_process';

export class VIPS {
  public async compress(imagePath: string): Promise<void> {
    const childProcess = spawn('vips', [`rot ${imagePath} x.jpg d90`], {
      shell: true,
      timeout: 10000, // 10 seconds
    });

    // Await the execution result
    await new Promise<void>((resolve, reject) => {
      childProcess.stdout.on('data', (c) => console.debug(`${c}`));
      childProcess.stderr.on('data', (c) => console.error(`${c}`));
      childProcess.on('close', (c) => {
        if (c !== 0) reject(c);
        else resolve();
      });
    });
  }
}
