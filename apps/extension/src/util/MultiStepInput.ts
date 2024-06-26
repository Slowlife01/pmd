import {
  Disposable,
  InputBox,
  QuickInput,
  QuickPick,
  QuickInputButton,
  QuickInputButtons,
  QuickPickItem,
  window,
} from "vscode";

export class InputFlowAction {
  static back = new InputFlowAction();
  static cancel = new InputFlowAction();
  static resume = new InputFlowAction();
}

export interface CustomButton<T> extends QuickInputButton {
  onClick?: (input: T) => Thenable<void>;
}

export type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

export interface QuickPickParameters<T extends QuickPickItem> {
  title: string;
  step: number;
  totalSteps: number;
  items: T[];
  activeItem?: T;
  placeholder: string;
  buttons?: CustomButton<QuickPickItem>[];
  shouldResume: () => Thenable<boolean>;
}

export interface InputBoxParameters {
  title: string;
  step: number;
  totalSteps: number;
  value: string;
  placeHolder?: string;
  prompt: string;
  validate: (value: string) => Promise<string | undefined>;
  buttons?: CustomButton<InputBox>[];
  shouldResume: () => Thenable<boolean>;
}

export class MultiStepInput {
  static async run<T>(start: InputStep) {
    const input = new MultiStepInput();
    return input.stepThrough(start);
  }

  private current?: QuickInput;
  private steps: InputStep[] = [];
  private timeouts: Record<string, NodeJS.Timeout> = {};

  private setTimeout(action: () => void, timeout = 1500, id = "default") {
    if (this.timeouts[id]) clearTimeout(this.timeouts[id]);
    this.timeouts[id] = setTimeout(action, timeout);
  }
  
  private async stepThrough<T>(start: InputStep) {
    let step: InputStep | void = start;
    while (step) {
      this.steps.push(step);

      if (this.current) {
        this.current.enabled = false;
        this.current.busy = true;
      }

      try {
        step = await step(this);
      } catch (err) {
        if (err === InputFlowAction.back) {
          this.steps.pop();
          step = this.steps.pop();
        } else if (err === InputFlowAction.resume) step = this.steps.pop();
        else if (err === InputFlowAction.cancel) step = undefined;
        else throw err;
      }
    }
    if (this.current) {
      this.current.dispose();
    }
  }

  async showQuickPick<
    T extends QuickPickItem,
    P extends QuickPickParameters<T>
  >({
    title,
    step,
    totalSteps,
    items,
    activeItem,
    placeholder,
    buttons,
    shouldResume,
  }: P) {
    const disposables: Disposable[] = [];
    try {
      return await new Promise<T>((resolve, reject) => {
        const input = window.createQuickPick<T>();
        input.title = title;
        input.step = step;
        input.totalSteps = totalSteps;
        input.placeholder = placeholder;
        input.items = items;
        if (activeItem) input.activeItems = [activeItem];
        input.buttons = [
          ...(this.steps.length > 1 ? [QuickInputButtons.Back] : []),
          ...(buttons || []),
        ];
        input.ignoreFocusOut = true;
        disposables.push(
          input.onDidTriggerButton((item: CustomButton<QuickPick<T>>) => {
            if (item === QuickInputButtons.Back) reject(InputFlowAction.back);
            else if (item.onClick) item.onClick(input);
          }),
          input.onDidChangeSelection((items) => resolve(items[0])),
          input.onDidHide(() => {
            (async () => {
              reject(
                shouldResume && (await shouldResume())
                  ? InputFlowAction.resume
                  : InputFlowAction.cancel
              );
            })().catch(reject);
          })
        );

        if (this.current)
          this.current.dispose();
        
        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach((d) => d.dispose());
    }
  }

  async showInputBox<P extends InputBoxParameters>({
    title,
    step,
    totalSteps,
    value,
    placeHolder,
    prompt,
    validate,
    buttons,
    shouldResume,
  }: P) {
    const disposables: Disposable[] = [];
    try {
      return await new Promise<string>((resolve, reject) => {
        const input = window.createInputBox();
        input.title = title;
        input.step = step;
        input.totalSteps = totalSteps;
        input.value = value || "";
        input.placeholder = placeHolder;
        input.prompt = prompt;
        input.buttons = [
          ...(this.steps.length > 1 ? [QuickInputButtons.Back] : []),
          ...(buttons || []),
        ];
        input.ignoreFocusOut = true;

        let validating = validate("");

        disposables.push(
          input.onDidTriggerButton((item: CustomButton<InputBox>) => {
            if (item === QuickInputButtons.Back) reject(InputFlowAction.back);
            else if (item.onClick) item.onClick(input);
          }),
          input.onDidAccept(async () => {
            const value = input.value;
            input.enabled = false;
            input.busy = true;

            const error = await validate(value)
            if (error) {
              input.validationMessage = error;
              this.setTimeout(() => input.validationMessage = undefined);
            } else resolve(value);

            input.enabled = true;
            input.busy = false;
          }),
          input.onDidChangeValue(async (text) => {
            const current = validate(text);
            validating = current;
            const validationMessage = await current;

            if (current === validating) {
              input.validationMessage = validationMessage;
              this.setTimeout(() => input.validationMessage = undefined);
            }
          }),
          input.onDidHide(() => {
            (async () => {
              reject(
                shouldResume && (await shouldResume())
                  ? InputFlowAction.resume
                  : InputFlowAction.cancel
              );
            })().catch(reject);
          })
        );

        if (this.current)
          this.current.dispose();

        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach((d) => d.dispose());
    }
  }
}
