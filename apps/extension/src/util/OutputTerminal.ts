import { EventEmitter, Terminal, window, ThemeIcon, commands } from "vscode"

import { format } from "node:util";
import chalk from "chalk";

export default class OutputTerminal {
    private terminal: Terminal
    private emitter: EventEmitter<string>

    constructor(name: string, isForCompiler = true) {
        this.emitter = new EventEmitter<string>();
        this.terminal = window.createTerminal({
            name: isForCompiler ? `${name} - pmd` : name,
            iconPath: new ThemeIcon('package'),
            pty: {
                open: () => null,
                close: () => {
                    if (!isForCompiler) return;
                    commands.executeCommand(`stopCompiler`);
                },
                onDidWrite: this.emitter.event
            }
        });
        this.terminal.hide();
    }

    append(...messages: string[]): void {
        this.emitter.fire(format(...messages));
    }

    appendLine(...messages: string[]): void {
        this.append(`${format(...messages)}\r\n`);
    }

    log = this.appendLine;
    error(...messages: string[]): void {
        this.appendLine(chalk.red(format(...messages)));
    };

    clear(): void {
        this.append('\x1bc\x1b[0J\x1b[1J\x1b[2J\x1b[3J\x1b[0;0H');
    }

    show(preserveFocus?: boolean): void {
        this.terminal.show(preserveFocus)
    }

    hide(): void {
        this.terminal.hide();
    }

    dispose(): void {
        this.terminal.dispose();
    }
}