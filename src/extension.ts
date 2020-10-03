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
	DebugAdapterNamedPipeServer,
	DebugAdapterTracker,
	DebugConfiguration,
	DebugSession,
	ProviderResult,
	WorkspaceFolder,
} from 'vscode';

export function activate(context: vscode.ExtensionContext) {
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

	if (false) {
		context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('ruby-byebug', {
			createDebugAdapterTracker(session: DebugSession): ProviderResult<DebugAdapterTracker> {
				return {
					onWillStartSession(): void {
						console.log(`${session.name} onWillStartSession`);
					},
					onWillReceiveMessage(message: any): void {
						console.log(`${session.name} onWillReceiveMessage =>`, message);
					},
					onDidSendMessage(message: any): void {
						console.log(`${session.name} onDidSendMessage =>`, message);
					},
					onWillStopSession(): void {
						console.log(`${session.name} onWillStopSession`);
					},
					onError(error: Error): void {
						console.log(`${session.name} onError =>`, error);
					},
					onExit(code: number | undefined, signal: string | undefined): void {
						console.log(`${session.name} onExit => code ${code}${signal ? ', signal ' + signal : ''}`);
					},
				};
			}
		}));
	}
}

export function deactivate() {}

class ByebugConfigurationProvider implements vscode.DebugConfigurationProvider {\
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
	private sessions = new Set<vscode.Disposable>();

	createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): ProviderResult<DebugAdapterDescriptor> {
		if (session.configuration.request == 'attach') {
			return new DebugAdapterNamedPipeServer(session.configuration.socket);
		}

		return new DebugAdapterExecutable('bundle', [
			'exec', 'byebug-dap', '--stdio', session.configuration.program
		], {
			cwd: session.configuration.cwd || path.dirname(session.configuration.program),
		});
	}

	dispose() {
		this.sessions.forEach(s => s.dispose());
	}
}
