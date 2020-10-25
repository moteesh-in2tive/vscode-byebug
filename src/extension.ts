import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { eventNames } from 'process';
import * as vscode from 'vscode';
import {
	CancellationToken,
	DebugAdapterDescriptor,
	DebugAdapterDescriptorFactory,
	DebugAdapterExecutable,
	DebugAdapterInlineImplementation,
	DebugAdapterNamedPipeServer,
	DebugAdapterTracker,
	DebugConfiguration,
	DebugSession,
	ProviderResult,
	WorkspaceFolder,
} from 'vscode';

import { deleteTempDir, getTempFilePath, randomName } from './utils';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('Byebug');

	context.subscriptions.push(vscode.debug.onDidReceiveDebugSessionCustomEvent(e => {
		switch (e.event) {
		case 'childSpawned':
			vscode.debug.startDebugging(e.session.workspaceFolder, {
				type: 'ruby-byebug',
				name: e.body!.name,
				request: 'attach',
				socket: e.body!.socket,
			} as AttachConfiguration, e.session);
		}
	}));

	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('ruby-byebug', new ByebugConfigurationProvider()));
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('ruby-byebug', new ByebugAdapterDescriptorFactory()));

	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('ruby-byebug', {
		provideDebugConfigurations(folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
			return [
				{
					name: 'Debug current file',
					type: 'ruby-byebug',
					request: 'launch',
					program: '${file}',
				}
			];
		}
	}));
}

export function deactivate() {
	deleteTempDir();
}

class ByebugConfigurationProvider implements vscode.DebugConfigurationProvider {
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {
		if (config.program || config.request == 'attach')
			return config;

		if (Object.keys(config).length > 0 && !config.program)
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return null;
			});

		// launch without configuration
		if (vscode.window.activeTextEditor?.document.languageId != 'ruby')
			return vscode.window.showInformationMessage("Select a ruby file to debug").then(_ => {
				return null;
			});

		return {
			type: 'ruby-byebug',
			name: 'Launch',
			request: 'launch',
			program: '${file}',
		};
	}
}

class ByebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	async createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): Promise<DebugAdapterDescriptor | null> {
		if (session.configuration.request == 'attach') {
			return new DebugAdapterNamedPipeServer(session.configuration.socket);
		}

		const config = session.configuration as LaunchConfiguration;
		config.rubyPath ||= 'ruby';
		config.bundlePath ||= 'bundle';
		config.byebugDapPath ||= 'byebug-dap';
		config.cwd ||= session.workspaceFolder?.uri?.fsPath || path.dirname(config.program);
		config.env = Object.assign({}, process.env, config.env || {});

		let program;
		const args = [];
		if (config.useBundler) {
			program = config.bundlePath;
			args.push('exec');
			args.push(config.byebugDapPath);
		} else {
			program = config.byebugDapPath;
		}

		if (config.showProtocolLog === true)
			args.push('--debug-protocol');

		const startCode = randomName(10);
		const startCodeRE = new RegExp(`^${startCode}$`, 'm');
		const socket = await getTempFilePath(`debug-${randomName(10)}.socket`);
		// args.push('--wait', '--stdio');
		args.push('--wait', '--capture-output', '--supress-output', '--on-start', startCode, '--unix', socket);
		args.push('--', config.program);
		if (config.args)
			args.push(...config.args);

		outputChannel.appendLine(`$ ${program} ${args.join(' ')}`);
		const dbg = spawn(program, args, {
			cwd: config.cwd,
			env: config.env,
			stdio: 'pipe',
		});

		let output = '';
		let ready: (r: Boolean) => void;
		let knownFailure = Promise.resolve(false);
		const setup = new Promise((resolve) => ready = resolve);

		const log = (b: Buffer) => {
			output += b.toString();
			if (output.indexOf('\n') < 0)
				return;

			if (/^bundler: command not found: byebug-dap$/m.test(output)) {
				knownFailure = this.gemfileIncludes('byebug-dap', config).then(includes => {
					if (includes)
						vscode.window.showErrorMessage(`Could not find 'byebug-dap'. Run \`bundle install\` to install byebug-dap from your Gemfile or set "byebugDapPath" in the launch configuration to the full path to the byebug-dap executable`);
					else
						vscode.window.showErrorMessage(`Could not find 'byebug-dap'. Add 'byebug-dap' to your Gemfile and run \`bundle install\` or set "byebugDapPath" in the launch configuration to the full path to the byebug-dap executable`);
					return true;
				});
			}

			if (!startCodeRE.test(output)) {
				let lines = output.split('\n');
				output = lines.splice(-1, 1)[0];
				lines.forEach(l => outputChannel.appendLine(l));
				return;
			}

			dbg.stdout.removeListener('data', log);
			dbg.stderr.removeListener('data', log);
			dbg.stderr.on('data', b => outputChannel.append(b.toString()));
			ready(true);
		};

		dbg.stdout.on('data', log);
		dbg.stderr.on('data', log);

		let stop = () => {
			stop = () => {};
			ready(false);
			vscode.debug.stopDebugging(session);
			fs.unlink(socket, () => {});
		};

		dbg.on('exit', async code => {
			stop();
			outputChannel.appendLine(`Exited with code ${code}`);
			if (code && !await knownFailure) outputChannel.show();
		});

		dbg.on('error', async (err: any) => {
			stop();
			outputChannel.appendLine(`Exited with error ${err}`);

			if (err.code !== 'ENOENT') {
				if (!await knownFailure)
					outputChannel.show();
				return;
			}

			switch (err.path) {
			case 'ruby':
				vscode.window.showErrorMessage(`Could not find 'ruby'. Set "rubyPath" in the launch configuration to the full path to the ruby executable.`);
				break;

			case 'bundle':
				vscode.window.showErrorMessage(`Could not find 'bundle'. Install 'bundler' with \`gem install bundler\` or set "bundlePath" in the launch configuration to the full path to bundle executable.`);
				break;

			case 'byebug-dap':
				if (this.gemfileIncludes('byebug-dap', config))
					vscode.window.showErrorMessage(`Could not find 'byebug-dap'. Set "useBundle" to \`true\` or set "byebugDapPath" to the full path to the byebug-dap executable in the launch configuration.`);
				else
					vscode.window.showErrorMessage(`Could not find 'byebug-dap'. Install 'byebug-dap' with \`gem install byebug-dap\` or set "byebugDapPath" in the launch configuration to the full path to the byebug-dap executable.`);
				break;

			default:
				vscode.window.showErrorMessage(`Could not find '${err.path}'`);
				break;
			}
		});

		if (!await setup)
			return null;

		return new DebugAdapterNamedPipeServer(socket);
	}

	private async run(cmd: string, args: string[], cwd: string): Promise<{ outs: string, errs: string, code?: number | null, err?: Error }> {
		return new Promise((resolve, reject) => {
			const child = spawn(cmd, args, { cwd });

			let outs = '', errs = '';
			child.stdout.on('data', b => outs += b.toString());
			child.stderr.on('data', b => errs += b.toString());
			child.on('error', err => reject({ errs, outs, err }));
			child.on('exit', code => (code == 0 ? resolve : reject)({ code, outs, errs }));
		});
	}

	private async gemfileIncludes(gem: string, config: LaunchConfiguration) {
		try {
			const { outs } = await this.run(config.rubyPath!, ['-e', "require 'bundler'; puts Bundler::Definition.build('Gemfile', nil, {}).dependencies.map(&:name)"], config.cwd!);
			return outs.split('\n').indexOf('byebug-dap') >= 0;
		} catch (_) {}
	}
}

interface AttachConfiguration extends DebugConfiguration {
	type: 'ruby-byebug';
	request: 'attach';
	socket: string;
}

interface LaunchConfiguration extends DebugConfiguration {
	type: 'ruby-byebug';
	request: 'attach';

	program: string;
	cwd?: string;
	args?: string[];
	env?: { [key: string]: string };

	showProtocolLog?: boolean;

	useBundler: boolean;
	rubyPath?: string;
	bundlePath?: string;
	byebugDapPath?: string;
}

