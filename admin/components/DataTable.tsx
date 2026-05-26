export type Column<Row> = {
  key: string;
  header: string;
  render: (row: Row) => React.ReactNode;
};

export function DataTable<Row>({
  rows,
  columns
}: {
  rows: Row[];
  columns: Array<Column<Row>>;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
