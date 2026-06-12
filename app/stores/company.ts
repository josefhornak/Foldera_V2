import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CompanyState {
  companyId: string | null;
  setCompanyId: (id: string | null) => void;
}

export const useCompanyStore = create<CompanyState>()(
  persist(
    (set) => ({
      companyId: null,
      setCompanyId: (companyId) => set({ companyId }),
    }),
    { name: 'foldera.company' }
  )
);
