import os = require('os');
import path = require('path');
import fs = require('fs');

const fsp = fs.promises;

async function exists(file: string): Promise<boolean> {
    try {
        await fsp.stat(file);
        return true;
    } catch (error) {
        if (error.code && error.code == 'ENOENT')
            return false;
        throw error;
    }
}

let tmpDir: string | undefined;
export async function getTempFilePath(name: string): Promise<string> {
	if (!tmpDir)
		tmpDir = await fsp.mkdtemp(os.tmpdir() + path.sep + 'vscode-go-test-adapter');

	if (!await exists(tmpDir))
		await fsp.mkdir(tmpDir);

	return path.normalize(path.join(tmpDir!, name));
}

export async function deleteTempDir() {
    if (!tmpDir) return;
    if (!await exists(tmpDir)) return;

    await rm(tmpDir);

    async function rm(dir: string) {
        const files = await fsp.readdir(dir);
        await Promise.all(files.map(async (name: string) => {
            const p = path.join(dir, name);
            const stat = await fsp.lstat(p);
            if (stat.isDirectory())
                await rm(p);
            else
                await fsp.unlink(p);
        }));
    }
}

export function randomName(l: number): string {
    let s = '';
    for (let i = 0; i < l; i++)
        s += String.fromCharCode(97 + Math.random() * 26);
    return s;
}