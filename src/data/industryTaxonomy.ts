/**
 * Every NAICS subsector, mapped to the operating model Wesify builds for it.
 *
 * The taxonomy answers "what kind of business is this"; this file answers "so what does it need".
 * The mapping is at subsector level (96 entries) because that is where the software actually changes
 * — soybean farming and wheat farming need the same system, but a farm and a foundry do not.
 *
 * Every value must be the id of a pack in `industryCapabilityPacks` or `extendedIndustryPacks`;
 * `industryTaxonomy.test.ts` enforces that, and that all 96 subsectors are covered.
 */
export const subsectorArchetypes: Record<string, string> = {
  // 11 Agriculture, Forestry, Fishing and Hunting
  111: 'agriculture', // Crop Production
  112: 'agriculture', // Animal Production and Aquaculture
  113: 'agriculture', // Forestry and Logging
  114: 'agriculture', // Fishing, Hunting and Trapping
  115: 'field-service', // Support Activities for Agriculture — dispatched crews and equipment
  // 21 Mining, Quarrying, and Oil and Gas Extraction
  211: 'extraction', // Oil and Gas Extraction
  212: 'extraction', // Mining (except Oil and Gas)
  213: 'field-service', // Support Activities for Mining — contracted site work
  // 22 Utilities
  221: 'utilities', // Utilities
  // 23 Construction
  236: 'construction', // Construction of Buildings
  237: 'construction', // Heavy and Civil Engineering Construction
  238: 'construction', // Specialty Trade Contractors
  // 31-33 Manufacturing
  311: 'manufacturing', // Food Manufacturing
  312: 'manufacturing', // Beverage and Tobacco Product Manufacturing
  313: 'manufacturing', // Textile Mills
  314: 'manufacturing', // Textile Product Mills
  315: 'manufacturing', // Apparel Manufacturing
  316: 'manufacturing', // Leather and Allied Product Manufacturing
  321: 'manufacturing', // Wood Product Manufacturing
  322: 'manufacturing', // Paper Manufacturing
  323: 'manufacturing', // Printing and Related Support Activities
  324: 'manufacturing', // Petroleum and Coal Products Manufacturing
  325: 'manufacturing', // Chemical Manufacturing
  326: 'manufacturing', // Plastics and Rubber Products Manufacturing
  327: 'manufacturing', // Nonmetallic Mineral Product Manufacturing
  331: 'manufacturing', // Primary Metal Manufacturing
  332: 'manufacturing', // Fabricated Metal Product Manufacturing
  333: 'manufacturing', // Machinery Manufacturing
  334: 'manufacturing', // Computer and Electronic Product Manufacturing
  335: 'manufacturing', // Electrical Equipment Manufacturing
  336: 'manufacturing', // Transportation Equipment Manufacturing
  337: 'manufacturing', // Furniture and Related Product Manufacturing
  339: 'manufacturing', // Miscellaneous Manufacturing
  // 42 Wholesale Trade
  423: 'wholesale', // Merchant Wholesalers, Durable Goods
  424: 'wholesale', // Merchant Wholesalers, Nondurable Goods
  425: 'wholesale', // Wholesale Trade Agents and Brokers
  // 44-45 Retail Trade
  441: 'retail', // Motor Vehicle and Parts Dealers
  444: 'retail', // Building Material and Garden Equipment Dealers
  445: 'retail', // Food and Beverage Retailers
  449: 'retail', // Furniture, Home Furnishings, Electronics, Appliance Retailers
  455: 'retail', // General Merchandise Retailers
  456: 'retail', // Health and Personal Care Retailers
  457: 'retail', // Gasoline Stations and Fuel Dealers
  458: 'retail', // Clothing, Accessories, Shoe, and Jewelry Retailers
  459: 'retail', // Sporting Goods, Hobby, Book, Miscellaneous Retailers
  // 48-49 Transportation and Warehousing
  481: 'logistics', // Air Transportation
  482: 'logistics', // Rail Transportation
  483: 'logistics', // Water Transportation
  484: 'logistics', // Truck Transportation
  485: 'logistics', // Transit and Ground Passenger Transportation
  486: 'utilities', // Pipeline Transportation — a metered network, not a fleet
  487: 'hospitality', // Scenic and Sightseeing Transportation — booked experiences
  488: 'logistics', // Support Activities for Transportation
  491: 'logistics', // Postal Service
  492: 'logistics', // Couriers and Messengers
  493: 'logistics', // Warehousing and Storage
  // 51 Information
  512: 'media', // Motion Picture and Sound Recording Industries
  513: 'media', // Publishing Industries
  516: 'media', // Broadcasting and Content Providers
  517: 'utilities', // Telecommunications — subscriber network with field operations
  518: 'saas', // Computing Infrastructure, Data Processing, Web Hosting
  519: 'media', // Web Search Portals, Libraries, Archives
  // 52 Finance and Insurance
  521: 'financial-services', // Monetary Authorities — Central Bank
  522: 'financial-services', // Credit Intermediation and Related Activities
  523: 'financial-services', // Securities, Commodity Contracts, Investments
  524: 'financial-services', // Insurance Carriers and Related Activities
  525: 'financial-services', // Funds, Trusts, and Other Financial Vehicles
  // 53 Real Estate and Rental and Leasing
  531: 'property', // Real Estate
  532: 'rental', // Rental and Leasing Services
  533: 'financial-services', // Lessors of Nonfinancial Intangible Assets
  // 54-56 Professional and administrative services
  541: 'professional-services', // Professional, Scientific, and Technical Services
  551: 'professional-services', // Management of Companies and Enterprises
  561: 'facilities', // Administrative and Support Services
  562: 'facilities', // Waste Management and Remediation Services
  // 61 Educational Services
  611: 'education', // Educational Services
  // 62 Health Care and Social Assistance
  621: 'healthcare', // Ambulatory Health Care Services
  622: 'healthcare', // Hospitals
  623: 'healthcare', // Nursing and Residential Care Facilities
  624: 'nonprofit', // Social Assistance — programme delivery against funding
  // 71 Arts, Entertainment, and Recreation
  711: 'events', // Performing Arts, Spectator Sports
  712: 'events', // Museums, Historical Sites
  713: 'events', // Amusement, Gambling, and Recreation
  // 72 Accommodation and Food Services
  721: 'hospitality', // Accommodation
  722: 'hospitality', // Food Services and Drinking Places
  // 81 Other Services
  811: 'field-service', // Repair and Maintenance
  812: 'personal-services', // Personal and Laundry Services
  813: 'membership', // Religious, Grantmaking, Civic, Professional Organizations
  814: 'personal-services', // Private Households
  // 92 Public Administration
  921: 'public-sector', // Executive, Legislative, General Government Support
  922: 'public-sector', // Justice, Public Order, and Safety
  923: 'public-sector', // Administration of Human Resource Programs
  924: 'public-sector', // Administration of Environmental Quality Programs
  925: 'public-sector', // Administration of Housing and Community Development
  926: 'public-sector', // Administration of Economic Programs
  927: 'public-sector', // Space Research and Technology
  928: 'public-sector', // National Security and International Affairs
}
