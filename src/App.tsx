import { Shell } from './app/Shell'
import { cloudConnected } from './data/app'
import { NoCloudScreen } from './features/nocloud'

export function App() {
  // A build made before the room's cloud exists has one page, and it says so.
  return cloudConnected ? <Shell /> : <NoCloudScreen />
}
