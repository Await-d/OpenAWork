/**
 * classic Team 右侧 layer/todo 工作台 · 交互状态 hook
 *
 * 纯派生见 team-layer-todo-workbench-model.ts；本 hook 只持有 selection 与回调。
 * 仅供 classic workbench 侧栏使用，不改 fusion 路径。
 */

import { useCallback, useMemo, useState } from 'react';
import type { TeamRoleLayer } from '../../../../stores/team/team-events.js';
import {
  buildTeamLayerTodoWorkbenchModel,
  selectLayer as selectLayerSelection,
  selectTodo as selectTodoSelection,
  type BuildWorkbenchModelInput,
  type WorkbenchMsgFilter,
  type WorkbenchSelection,
  type WorkbenchTabKey,
  type WorkbenchTodoFilter,
} from './team-layer-todo-workbench-model.js';

const INITIAL_SELECTION: WorkbenchSelection = {
  tab: 'tasks',
  layerId: 'all',
  roleId: 'all',
  todoId: null,
  todoFilter: 'all',
  msgFilter: 'all',
};

export interface UseTeamLayerTodoWorkbenchModelInput {
  layers?: BuildWorkbenchModelInput['layers'];
  handoffs?: BuildWorkbenchModelInput['handoffs'];
  runtimeTasks?: BuildWorkbenchModelInput['runtimeTasks'];
  sessionTodos?: BuildWorkbenchModelInput['sessionTodos'];
}

export function useTeamLayerTodoWorkbenchModel(input: UseTeamLayerTodoWorkbenchModelInput) {
  const [selection, setSelection] = useState<WorkbenchSelection>(INITIAL_SELECTION);

  const model = useMemo(
    () =>
      buildTeamLayerTodoWorkbenchModel({
        layers: input.layers,
        handoffs: input.handoffs,
        runtimeTasks: input.runtimeTasks,
        sessionTodos: input.sessionTodos,
        selection,
      }),
    [input.handoffs, input.layers, input.runtimeTasks, input.sessionTodos, selection],
  );

  const setTab = useCallback((tab: WorkbenchTabKey) => {
    setSelection((prev) => ({ ...prev, tab }));
  }, []);

  const setTodoFilter = useCallback((todoFilter: WorkbenchTodoFilter) => {
    setSelection((prev) => ({ ...prev, todoFilter }));
  }, []);

  const setMsgFilter = useCallback((msgFilter: WorkbenchMsgFilter) => {
    setSelection((prev) => ({ ...prev, msgFilter }));
  }, []);

  const onSelectLayer = useCallback(
    (layerId: TeamRoleLayer | 'all', roleId: string | 'all' = 'all') => {
      setSelection((prev) => selectLayerSelection(prev, layerId, roleId, model.todos));
    },
    [model.todos],
  );

  const onSelectRole = useCallback(
    (roleId: string | 'all') => {
      setSelection((prev) => {
        const layerId = prev.layerId;
        return selectLayerSelection(prev, layerId, roleId, model.todos);
      });
    },
    [model.todos],
  );

  const onSelectTodo = useCallback(
    (todoId: string) => {
      setSelection((prev) => selectTodoSelection(prev, todoId, model.todos));
    },
    [model.todos],
  );

  return {
    model,
    selection: model.selection,
    setTab,
    setTodoFilter,
    setMsgFilter,
    onSelectLayer,
    onSelectRole,
    onSelectTodo,
  };
}
