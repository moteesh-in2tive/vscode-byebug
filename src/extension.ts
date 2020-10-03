import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { eventNames } from 'process';
import * as vscode from 'vscode';
import {
	WorkspaceFolder,
	DebugConfiguration,
	ProviderResult,
	CancellationToken,
	DebugSession,
	DebugAdapterExecutable,
	DebugAdapterDescriptor,
	DebugAdapterNamedPipeServer,
	DebugAdapterDescriptorFactory,
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
}

export function deactivate() {}

class ByebugConfigurationProvider implements vscode.DebugConfigurationProvider {
	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
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
			'exec', 'byebug-dap', 'stdio', session.configuration.program
		], {
			cwd: session.configuration.cwd || path.dirname(session.configuration.program),
		});
	}

	dispose() {
		this.sessions.forEach(s => s.dispose());
	}
}