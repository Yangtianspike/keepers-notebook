"use client";

import type { Act, Clue, Person } from "@/lib/types";

export function PersonDetailPanel({
  person,
  acts,
  clues,
  onClose,
  onSelectAct,
  onUpdatePerson,
}: {
  person: Person;
  acts: Act[];
  clues: Clue[];
  onClose: () => void;
  onSelectAct: (actId: string) => void;
  onUpdatePerson: (person: Person) => void;
}) {
  const appearances = acts.filter((act) => act.personIds.includes(person.id));
  const actClueIds = new Set(appearances.flatMap((act) => act.clueIds));
  const relatedClues = clues.filter(
    (clue) =>
      actClueIds.has(clue.id) ||
      clue.targets.some(
        (target) =>
          target.type === "person" &&
          (target.id === person.id ||
            target.label === person.name ||
            person.aliases.includes(target.label)),
      ),
  );

  const uploadPortrait = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const scale = Math.min(1, 256 / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext("2d");
          if (!context) return;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          onUpdatePerson({
            ...person,
            portrait: canvas.toDataURL("image/jpeg", 0.72),
            portraitSource: "manual",
          });
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  return (
    <div className="person-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="person-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${person.name}人物详情`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="person-detail-identity">
            <button
              className="person-detail-portrait"
              onClick={uploadPortrait}
              title="上传或更换肖像"
            >
              {person.portrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={person.portrait} alt={person.name} />
              ) : (
                <span>{person.name.slice(0, 1)}</span>
              )}
            </button>
            <div>
              <span>{person.importance}</span>
              <h2>{person.name}</h2>
              <p>{person.role}</p>
            </div>
          </div>
          <button className="panel-close" aria-label="关闭人物详情" onClick={onClose}>
            ×
          </button>
        </header>

        <section>
          <h3>人物档案</h3>
          <dl>
            <dt>公开身份</dt>
            <dd>{person.publicIdentity || "未知"}</dd>
            <dt>真实身份</dt>
            <dd>{person.trueIdentity || "未知"}</dd>
            <dt>动机</dt>
            <dd>{person.motivation || "未知"}</dd>
            <dt>秘密</dt>
            <dd>{person.secrets.join("；") || "无"}</dd>
          </dl>
        </section>

        <section>
          <h3>出现在以下幕中</h3>
          <div className="person-detail-links">
            {appearances.map((act) => (
              <button key={act.id} onClick={() => onSelectAct(act.id)}>
                <span>第 {act.sequence} 幕</span>
                <strong>{act.title}</strong>
              </button>
            ))}
            {appearances.length === 0 && <p>暂无幕记录。</p>}
          </div>
        </section>

        <section>
          <h3>关联线索</h3>
          <ul>
            {relatedClues.map((clue) => (
              <li key={clue.id}>
                <strong>{clue.name}</strong>
                <span>{clue.summary}</span>
              </li>
            ))}
          </ul>
          {relatedClues.length === 0 && <p>暂无关联线索。</p>}
        </section>
      </aside>
    </div>
  );
}
