import { Navigate, Route, Routes } from 'react-router-dom'

import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminPanel } from './pages/AdminPanel'
import { Assignments } from './pages/Assignments'
import { Dashboard } from './pages/Dashboard'
import { DepartmentDetail } from './pages/DepartmentDetail'
import { DepartmentList } from './pages/DepartmentList'
import { EmployeeDetail } from './pages/EmployeeDetail'
import { Employees } from './pages/Employees'
import { Login } from './pages/Login'
import { MpkReference } from './pages/MpkReference'
import { NotificationsPage } from './pages/Notifications'
import { ProductDetail } from './pages/ProductDetail'
import { Products } from './pages/Products'
import { ProjectDetail } from './pages/ProjectDetail'
import { Projects } from './pages/Projects'
import { HiringDetail } from './pages/HiringDetail'
import { HiringList } from './pages/HiringList'
import { Rotations } from './pages/Rotations'
import { SelfReviewDetail } from './pages/SelfReviewDetail'
import { SelfReviewList } from './pages/SelfReviewList'
import { VacancyDetail } from './pages/VacancyDetail'
import { VacancyList } from './pages/VacancyList'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employees"
        element={
          <ProtectedRoute>
            <Layout>
              <Employees />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employees/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <EmployeeDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/mpk-reference"
        element={
          <ProtectedRoute>
            <Layout>
              <MpkReference />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/products"
        element={
          <ProtectedRoute>
            <Layout>
              <Products />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/products/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <ProductDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects"
        element={
          <ProtectedRoute>
            <Layout>
              <Projects />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <ProjectDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/departments"
        element={
          <ProtectedRoute>
            <Layout>
              <DepartmentList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/departments/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <DepartmentDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/rotations"
        element={
          <ProtectedRoute>
            <Layout>
              <Rotations />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/self-review"
        element={
          <ProtectedRoute>
            <Layout>
              <SelfReviewList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/self-review/:employeeId/:reviewId"
        element={
          <ProtectedRoute>
            <Layout>
              <SelfReviewDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/hiring"
        element={
          <ProtectedRoute>
            <Layout>
              <HiringList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/hiring/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <HiringDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/vacancies"
        element={
          <ProtectedRoute>
            <Layout>
              <VacancyList />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/vacancies/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <VacancyDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/assignments"
        element={
          <ProtectedRoute>
            <Layout>
              <Assignments />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/notifications"
        element={
          <ProtectedRoute>
            <Layout>
              <NotificationsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <Layout>
              <AdminPanel />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
