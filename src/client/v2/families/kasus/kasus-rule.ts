import type { Lang } from '../../../i18n.js';
import type { KasusRule } from './kasus-model.js';
import type { KasusUiTranslations } from './kasus-i18n.js';

/** The rule window of FC07: title, explanation, the declension table with the row that decides the task
 * marked, and examples. A modal <dialog>: Esc, the close buttons and the backdrop close it, focus returns
 * to the button that opened it. Opening or closing it records nothing. */
export interface RuleWindow {
  readonly open: boolean;
  show(rule: KasusRule, row: number, language: Lang, labels: KasusUiTranslations, opener?: HTMLElement): void;
  /** Re-render in another interface language, keeping it open. */
  localize(language: Lang, labels: KasusUiTranslations): void;
  close(): void;
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};

export function createRuleWindow(dialog: HTMLDialogElement): RuleWindow {
  let shown: { rule: KasusRule; row: number } | undefined;
  let opener: HTMLElement | undefined;

  function render(language: Lang, labels: KasusUiTranslations): void {
    if (!shown) return;
    const { rule, row } = shown;
    dialog.lang = language;
    const head = node('div', undefined, 'dc-rule-head');
    const title = node('h2', rule.title[language]); title.id = 'ruleTitle';
    const close = node('button', '×', 'dc-rule-x'); close.type = 'button'; close.setAttribute('aria-label', labels.ruleClose);
    close.addEventListener('click', hide);
    head.append(title, close);
    const body = node('div', undefined, 'dc-rule-body');
    for (const paragraph of rule.body[language]) body.append(node('p', paragraph));
    const wrap = node('div', undefined, 'dc-rule-table');
    const table = node('table');
    const headRow = node('tr');
    for (const heading of rule.table.head[language]) { const cell = node('th', heading); cell.scope = 'col'; headRow.append(cell); }
    const thead = node('thead'); thead.append(headRow);
    const tbody = node('tbody');
    rule.table.rows.forEach((entry, index) => {
      const line = node('tr'); line.dataset.row = String(index);
      const gender = node('th', entry.gender[language]); gender.scope = 'row';
      const cells = [entry.nom, entry.form, entry.indef, entry.kein].map((value, column) => {
        const cell = node('td'); cell.lang = 'de';
        cell.append(column === 1 ? node('strong', value) : value); return cell;
      });
      line.append(gender, ...cells);
      if (index === row) {
        // The row that decides this task: marked visibly and for screen readers.
        line.className = 'dc-rule-hit'; line.setAttribute('aria-current', 'true');
        gender.append(node('span', ` (${labels.ruleRow})`, 'dc-visually-hidden'));
      }
      tbody.append(line);
    });
    table.append(thead, tbody); wrap.append(table); body.append(wrap);
    body.append(node('h3', labels.examples));
    const examples = node('ul', undefined, 'dc-rule-examples');
    for (const example of rule.examples) {
      const item = node('li'); const german = node('span', example.de, 'dc-rule-de'); german.lang = 'de';
      item.append(german);
      if (language !== 'de') { const translated = node('span', example[language], 'dc-rule-tr'); translated.lang = language; item.append(translated); }
      examples.append(item);
    }
    body.append(examples);
    const foot = node('div', undefined, 'dc-rule-foot');
    const done = node('button', labels.ruleClose); done.type = 'button'; done.id = 'ruleDone'; done.addEventListener('click', hide);
    foot.append(done);
    // The dialog itself has no padding, so a click on it (not on the panel) is a click on the backdrop.
    const panel = node('div', undefined, 'dc-rule-panel'); panel.append(head, body, foot);
    dialog.replaceChildren(panel);
    dialog.setAttribute('aria-labelledby', 'ruleTitle');
  }
  function hide(): void { if (dialog.open) dialog.close(); }

  // Esc and the close buttons end in `close`; focus goes back to the opener (the Rule button).
  dialog.addEventListener('close', () => { const target = opener; opener = undefined; if (target?.isConnected) target.focus(); });
  // A click on the backdrop lands on the dialog element itself, outside its content.
  dialog.addEventListener('click', event => { if (event.target === dialog) hide(); });

  return {
    get open() { return dialog.open; },
    show(rule, row, language, labels, from) {
      shown = { rule, row }; opener = from; render(language, labels);
      if (!dialog.open) dialog.showModal();
      // Focus on Close (Enter/Space close it again) without scrolling a long rule to its end on a phone.
      dialog.querySelector<HTMLButtonElement>('#ruleDone')?.focus({ preventScroll: true }); dialog.scrollTop = 0;
    },
    localize(language, labels) { if (dialog.open) render(language, labels); },
    close: hide,
  };
}
