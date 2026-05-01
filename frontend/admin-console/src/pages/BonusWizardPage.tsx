import { useNavigate } from 'react-router-dom'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import BonusWizardFlow from '../components/bonus/BonusWizardFlow'

export default function BonusWizardPage() {
  const navigate = useNavigate()

  return (
    <>
      <PageMeta title="Bonus Engine · Create bonus" description="Guided bonus creation." />
      <PageBreadcrumb pageTitle="Create promotion" />
      <BonusWizardFlow
        onCancel={() => navigate('/bonushub')}
        onCreated={(pid) => navigate(`/bonushub/promotions/${pid}/rules`)}
      />
    </>
  )
}
