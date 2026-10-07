import { formatIndustryCell, industryDataSections } from './dataTable';

export function IndustryDataTable({ kind, normalized }: { kind: 'section' | 'drill'; normalized: Record<string, unknown> }) {
  const sections = industryDataSections(kind, normalized);
  return <details className="industry-appendix">
    <summary>附表与来源位置</summary>
    <div className="industry-appendix-body">
      {sections.map(section => <section key={section.key} aria-label={section.title}>
        <h4>{section.title} <span>（{section.rows.length} 条）</span></h4>
        {section.rows.length ? <div className="industry-table-scroll" role="region" aria-label={`${section.title}，可横向滚动`} tabIndex={0}>
          <table>
            <thead><tr>{section.columns.map(column => <th key={column.key} scope="col">{column.label}{column.unit ? <small>{column.unit}</small> : null}</th>)}</tr></thead>
            <tbody>{section.rows.map((row, index) => <tr key={`${String(row.id ?? row.depth_m ?? 'row')}-${index}`}>
              {section.columns.map(column => <td key={column.key}>{formatIndustryCell(column.key === 'source_display' ? row.source_display : row[column.key])}</td>)}
            </tr>)}</tbody>
          </table>
        </div> : <p className="industry-empty">无记录</p>}
      </section>)}
      <details className="industry-source-json">
        <summary>原始字段与完整来源追溯</summary>
        <pre>{JSON.stringify(normalized, null, 2)}</pre>
      </details>
    </div>
  </details>;
}
