export default function Settings() {
  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Settings</h1>
        
        <div className="bg-gray-800 p-6 rounded-lg mb-6">
          <h2 className="text-xl font-semibold mb-4">Profile</h2>
          <div className="mb-4">
            <label className="block mb-2">Display Name</label>
            <input
              type="text"
              className="w-full p-2 rounded bg-gray-700 text-white"
              placeholder="Your display name"
            />
          </div>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg mb-6">
          <h2 className="text-xl font-semibold mb-4">Security</h2>
          <div className="mb-4">
            <h3 className="text-lg mb-2">Devices</h3>
            <p className="text-gray-400">Manage your linked devices</p>
          </div>
          <div className="mb-4">
            <h3 className="text-lg mb-2">Recovery Phrase</h3>
            <p className="text-gray-400">Backup your recovery phrase</p>
          </div>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Privacy</h2>
          <div className="mb-4">
            <label className="flex items-center">
              <input type="checkbox" className="mr-2" />
              <span>Show read receipts</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
