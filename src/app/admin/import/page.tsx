export default function AdminImportPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">Data Import</h1>
      <p className="text-neutral-600 mb-8">
        Import UAE activity, jurisdiction, approval and fee data from official
        sources.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 p-6 bg-white">
          <h2 className="text-lg font-semibold mb-4">Import File</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                File Format
              </label>
              <select className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
                <option>CSV</option>
                <option>XLSX</option>
                <option>JSON</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Target Jurisdiction
              </label>
              <select className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
                <option value="">Select jurisdiction...</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                File
              </label>
              <input
                type="file"
                accept=".csv,.xlsx,.json"
                className="w-full text-sm text-neutral-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>
            <button className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              Import Data
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 p-6 bg-white">
          <h2 className="text-lg font-semibold mb-4">Import Guidelines</h2>
          <ul className="text-sm text-neutral-600 space-y-2">
            <li>
              Only import data from official UAE government sources
            </li>
            <li>
              Preserve exact official activity names
            </li>
            <li>
              Include source URLs for all records
            </li>
            <li>
              Activity codes must match official codes exactly
            </li>
            <li>
              Never invent or guess regulatory data
            </li>
            <li>
              Run the data quality audit after import
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
