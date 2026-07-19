import { TitlebarLayoutModeControl } from './shared/TitlebarLayoutModeControl.js';
import { WorkbenchModeTabs } from './WorkbenchModeTabs.js';
import './ClassicWorkbenchTitlebar.css';

export function ClassicWorkbenchTitlebar() {
  return (
    <header className="classic-workbench-titlebar" aria-label="经典布局工作台切换栏">
      <WorkbenchModeTabs />
      <TitlebarLayoutModeControl />
    </header>
  );
}
