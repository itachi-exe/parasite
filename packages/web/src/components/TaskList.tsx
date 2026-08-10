'use client';

import { TASK_DEFS, AREAS, type TaskId } from '@parasite/shared';

const AREA_NAME = new Map(AREAS.filter((a) => a.id !== 'path').map((a) => [a.id, a.name]));

/**
 * Left panel: this player's task list.
 *
 * In Inco mode the Parasite is shown the same five tasks as everyone else — they
 * are fake, and the Parasite knows it, but they must LOOK identical because
 * anyone glancing at a Parasite's screen (or a stream) should not be able to
 * tell. The completion calls are simply never sent.
 */
export default function TaskList(props: {
  myTasks: TaskId[];
  done: TaskId[];
  activeTask: TaskId | null;
  isParasite: boolean;
}) {
  const { myTasks, done, activeTask, isParasite } = props;

  return (
    <div className="panel sidebar sidebar-left">
      <h2 className="panel-title">Tasks</h2>
      <div className="scroll">
        {myTasks.map((id) => {
          const def = TASK_DEFS.find((t) => t.id === id)!;
          const isDone = done.includes(id);
          const isActive = activeTask === id && !isDone;
          return (
            <div
              key={id}
              className={`task${isActive ? ' active' : ''}${isDone ? ' done' : ''}`}
            >
              <span className="task-check">{isDone ? '✔' : '○'}</span>
              <span>
                <span className="task-name">{def.name}</span>
                <br />
                <span className="task-where">{AREA_NAME.get(def.area) ?? def.area}</span>
              </span>
            </div>
          );
        })}

        {isParasite && (
          <div className="mono-note">
            Your tasks are <strong>fake</strong>. Completing them does nothing — but the
            list looks identical to a human&apos;s, so nobody can tell by watching your
            screen.
          </div>
        )}
      </div>
    </div>
  );
}
