"use client";

import type { AdminDepartment, Administration } from "@chronica/shared";
import { Linkify, LinkedName } from "./notes";
import { Fact, Facts, Registry, RegistryRow } from "./registry";

/**
 * The state's work, divided: its departments, who heads each, and what is known
 * to be wrong.
 *
 * A vacancy and an unnamed holder look different here because they are: the
 * first is an office the record says is empty, the second a body the record
 * says is filled and does not name. A discovered irregularity is listed with
 * what the audit found; a theft nobody has found is not on this page at all,
 * because the player does not know of it. A rumour is called a rumour.
 */
export function AdministrationSheet({ administration, focusKey }: { readonly administration: Administration; readonly focusKey?: string | undefined }) {
  if (administration.departments.length === 0) return <p className="quiet">No department is recorded that you keep the books of.</p>;
  return (
    <div className="books administration">
      <Registry label="Departments">
        {administration.departments.map((department) => <Department key={department.key} department={department} open={department.key === focusKey} />)}
      </Registry>
      {administration.authorisations.length > 0 && (
        <section className="books__side">
          <h3>Spending the councils have authorised</h3>
          <ul className="ruled books__list">{administration.authorisations.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

function Department({ department, open }: { readonly department: AdminDepartment; readonly open: boolean }) {
  const head = department.head;
  const responsibilities = department.responsibilities.length === 0 ? "Whatever its name implies" : capitalise(department.responsibilities.join(", "));
  return (
    <RegistryRow
      id={department.key}
      title={department.name}
      meta={department.issue?.text}
      marked={department.issue?.marked === true}
      openOnArrival={open}
      sentence={<>{head.person === null ? head.summary : <><LinkedName linked={head.person} />{head.summary.slice(head.person.label.length)}</>}.</>}
    >
      <Facts>
        <Fact term="Duties">{responsibilities}.</Fact>
        <Fact term="Officers">
          {department.posts.length === 0 ? "No office is named for it." : department.posts.map((post) => (
            <span key={post.key} className={`registry__line registry__post is-${post.condition}`}>
              <strong><Linkify text={post.officeLabel} /></strong>
              {post.holders.length > 0 && <> — {post.holders.map((holder, index) => <span key={holder.label}>{index > 0 && ", "}<LinkedName linked={holder} /></span>)}</>}
              {post.note !== "" && <> {post.note}</>}
            </span>
          ))}
        </Fact>
        <Fact term="Money">{department.spending.map((line) => <span key={line} className="registry__line">{line}</span>)}</Fact>
        <Fact term="Work">
          {department.work.length === 0 ? "None that you know of." : department.work.map((work) => (
            <span key={work.key} className={work.stalled ? "registry__line is-stalled" : "registry__line"}><strong>{work.label}</strong> {work.detail}</span>
          ))}
        </Fact>
        <Fact term="Books">
          {department.findings.length === 0 ? "Nothing is known against it." : department.findings.map((finding) => (
            <span key={finding.key} className={`registry__line registry__finding is-${finding.kind}`}>{finding.text}</span>
          ))}
        </Fact>
      </Facts>
    </RegistryRow>
  );
}

const capitalise = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);
