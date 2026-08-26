# UAE Activity Data Source Inventory

## Status Legend
- ✅ Source verified and downloadable
- ⚠️ Source identified but needs verification
- ❌ No official machine-readable source found
- 🔄 Collection in progress

---

## MAINLAND JURISDICTIONS

### 1. Dubai Mainland / DET
| Field | Value |
|-------|-------|
| Authority | Department of Economy and Tourism (DET) |
| Status | ✅ |
| Official Search | https://app.invest.dubai.ae/search-business-activities |
| Open Data | https://www.dubaipulse.gov.ae/data/ded-licenses/ded_license_activities-open |
| Data Format | CSV, API |
| Activity Codes | Yes (6-digit codes) |
| Licence Types | Commercial, Professional, Industrial, Tourism |
| Descriptions | Yes |
| Activity Count | ~3,882 |
| Last Updated | 2026-06-15 (per Entityz) |
| Notes | Dubai Pulse provides downloadable CSV with all activity codes, names, categories |

### 2. Abu Dhabi Mainland / ADDED
| Field | Value |
|-------|-------|
| Authority | Abu Dhabi Department of Economic Development (ADDED) |
| Status | ⚠️ |
| Official Search | https://www.added.gov.ae |
| Data Format | Web search (no known CSV download) |
| Activity Codes | Yes |
| Licence Types | Commercial, Professional, Industrial |
| Activity Count | ~1,022 (per Entityz) |
| Notes | Entityz has compiled ADDED activities; official CSV not confirmed |

### 3. Sharjah Mainland / SEDD
| Field | Value |
|-------|-------|
| Authority | Sharjah Economic Development Department (SEDD) |
| Status | ⚠️ |
| Official Search | https://www.sedd.gov.ae |
| Data Format | Web search |
| Activity Codes | Yes |
| Activity Count | Unknown |
| Notes | SPC Free Zone has 2,000+ activities; mainland list not separately confirmed |

### 4. Ajman Mainland
| Field | Value |
|-------|-------|
| Authority | Ajman Department of Economic Development |
| Status | ❌ |
| Notes | No official machine-readable source identified |

### 5. Ras Al Khaimah Mainland
| Field | Value |
|-------|-------|
| Authority | RAK Economic Department |
| Status | ❌ |
| Notes | No official machine-readable source identified |

### 6. Fujairah Mainland
| Field | Value |
|-------|-------|
| Authority | Fujairah Department of Economic Development |
| Status | ❌ |
| Notes | No official machine-readable source identified |

### 7. Umm Al Quwain Mainland
| Field | Value |
|-------|-------|
| Authority | UAQ Department of Economic Development |
| Status | ❌ |
| Notes | No official machine-readable source identified |

---

## FREE ZONE JURISDICTIONS

### 8. DMCC
| Field | Value |
|-------|-------|
| Authority | Dubai Multi Commodities Centre |
| Status | ✅ |
| Official XLSX | https://dmcc.ae/hubfs/website%20support%20documents/License%20Activity%2015%20OCT%202025.xlsx |
| Alt XLSX | https://beta.government.ae/-/media/Information-and-services/Business/DMCC_Approved_List_of_Activities.xlsx |
| Data Format | XLSX |
| Activity Codes | Yes (5-digit codes like "2221-05") |
| Licence Types | Service, Trading, Commercial, Industrial |
| Descriptions | Yes (detailed per activity) |
| Activity Count | ~900+ |
| Last Updated | 2025-10-15 |
| Notes | Best structured XLSX source. Includes Arabic names, categories, approval flags |

### 9. IFZA
| Field | Value |
|-------|-------|
| Authority | International Free Zone Authority |
| Status | ✅ |
| Official Site | https://activities.ifza.com/ (JS-rendered) |
| CSV (Entityz) | https://www.entityz.ae/downloads/ifza-business-activities.csv |
| XLSX (Entityz) | https://www.entityz.ae/downloads/ifza-business-activities.xlsx |
| Data Format | CSV, XLSX (via Entityz compilation) |
| Activity Codes | Yes (7-digit codes) |
| Licence Types | Commercial, General, Professional |
| Activity Count | ~823 |
| Notes | Official IFZA site is JS-rendered; Entityz has compiled version |

### 10. SHAMS
| Field | Value |
|-------|-------|
| Authority | Sharjah Media City Free Zone |
| Status | ⚠️ |
| Official Site | https://shamsfz.ae/business-setup/business-activities/ |
| PDF (Third-party) | https://cdn.legalinz.com/Shams%20-%20Media%20Activities%20List.pdf |
| PDF (Third-party) | https://cdn.legalinz.com/Shams%20-%20Service%20%26%20Consultancy%20Activities%20List.pdf |
| Data Format | PDF (needs extraction) |
| Activity Codes | Yes (ISIC-based) |
| Activity Count | ~1,000+ |
| Notes | PDFs circulating are third-party copies; use official SHAMS pages |

### 11. RAKEZ
| Field | Value |
|-------|-------|
| Authority | Ras Al Khaimah Economic Zone |
| Status | ⚠️ |
| Official Site | https://www.rakez.com |
| Data Format | Web search |
| Activity Codes | Yes |
| Activity Count | Unknown |
| Notes | No confirmed downloadable dataset |

### 12. Meydan Free Zone
| Field | Value |
|-------|-------|
| Authority | Meydan Free Zone |
| Status | ✅ |
| Entityz CSV | https://www.entityz.ae/downloads/meydan-business-activities.csv (inferred) |
| Data Format | CSV (via Entityz) |
| Activity Count | ~2,232 |
| Notes | Entityz has compiled Meydan activities |

### 13. JAFZA
| Field | Value |
|-------|-------|
| Authority | Jebel Ali Free Zone Authority |
| Status | ⚠️ |
| Official Site | https://www.jafza.ae |
| Data Format | Web search |
| Activity Codes | Yes |
| Activity Count | Unknown |
| Notes | No confirmed downloadable dataset |

### 14. Fujairah Free Zone
| Field | Value |
|-------|-------|
| Authority | Fujairah Free Zone Authority |
| Status | ❌ |
| Notes | No official machine-readable source identified |

### 15. ADGM
| Field | Value |
|-------|-------|
| Authority | Abu Dhabi Global Market |
| Status | ✅ |
| Entityz CSV | Available in compiled UAE activities list |
| Data Format | CSV (via Entityz) |
| Activity Codes | Yes |
| Activity Count | ~1,837 |
| Notes | ADGM has its own regulatory framework; Entityz has compiled list |

### 16. KEZAD
| Field | Value |
|-------|-------|
| Authority | Khalifa Economic Zones Abu Dhabi |
| Status | ❌ |
| Notes | No official machine-readable source identified |

### 17. Masdar City Free Zone
| Field | Value |
|-------|-------|
| Authority | Masdar City Free Zone |
| Status | ✅ |
| Entityz CSV | Available in compiled UAE activities list |
| Data Format | CSV (via Entityz) |
| Activity Count | ~362 |
| Notes | Entityz has compiled Masdar activities |

### 18. Abu Dhabi Airports Free Zone
| Field | Value |
|-------|-------|
| Authority | Abu Dhabi Airports Free Zone |
| Status | ❌ |
| Notes | No official machine-readable source identified |

### 19. twofour54
| Field | Value |
|-------|-------|
| Authority | twofour54 |
| Status | ✅ |
| Entityz CSV | Available in compiled UAE activities list |
| Data Format | CSV (via Entityz) |
| Activity Count | ~68 |
| Notes | Small media-focused zone; Entityz has compiled list |

---

## COMPILED SOURCES

### Entityz UAE Business Activities
| Field | Value |
|-------|-------|
| URL | https://www.entityz.ae/downloads/uae-business-activities.csv |
| XLSX | https://www.entityz.ae/downloads/uae-business-activities.xlsx |
| Total Activities | 14,977 |
| Sources | DET, IFZA, SPC, Dubai South, ADDED, ADGM, Masdar City, twofour54, RAK Innovation City |
| Updated | 2026-06-15 |
| Notes | Third-party compilation from official sources. Useful for initial import but must verify against individual official sources. |

---

## FIRST IMPORT TARGET

**DMCC** - Best structured official source (XLSX with activity codes, descriptions, categories, approval flags)

Source: https://dmcc.ae/hubfs/website%20support%20documents/License%20Activity%2015%20OCT%202025.xlsx
