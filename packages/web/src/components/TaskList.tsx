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
    <section className="panel sidebar sidebar-left" aria-labelledby="tasks-heading">
      <h2 className="panel-title" id="tasks-heading">
        Tasks
      </h2>
      <div className="scroll">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {myTasks.map((id) => {
            const def = TASK_DEFS.find((t) => t.id === id)!;
            const isDone = done.includes(id);
            const isActive = activeTask === id && !isDone;
            const where = AREA_NAME.get(def.area) ?? def.area;
            return (
              <li
                key={id}
                className={`task${isActive ? ' active' : ''}${isDone ? ' done' : ''}`}
              >
                {/*
                  The glyph is decorative — the same state is in the text below,
                  so a screen reader is not left reading "check mark" and
                  guessing what it applies to.
                */}
                <span className="task-check" aria-hidden="true">
                  {isDone ? '✔' : '○'}
                </span>
                <span>
                  <span className="task-name">{def.name}</span>
                  <br />
                  <span className="task-where">{where}</span>
                  <span className="sr-only">
                    {isDone ? ', complete' : isActive ? ', in reach now' : ', not started'}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        {isParasite && (
          <div className="mono-note">
            Your tasks are <strong>fake</strong>. Completing them does nothing, but the
            list looks identical to a human&apos;s, so nobody can tell by watching your
            screen.
          </div>
        )}
      </div>
    </section>
  );
}
