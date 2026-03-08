import { TopBar } from "@/components/layout/TopBar"
import { Navbar } from "@/components/layout/Navbar"
import { SubNav } from "@/components/layout/SubNav"
import { StorePage } from "@/pages/StorePage"

function App() {
  return (
    <div className="min-h-screen bg-[#1b2838] text-white">
      <TopBar />
      <Navbar />
      <SubNav />
      <StorePage />
    </div>
  )
}

export default App
