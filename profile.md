# Applicant profile

Edit this file with candidate details used by AI Analyze.

The planner should answer every form question it can. When a detail is absent here,
the model chooses a sensible answer (or a `{{PLACEHOLDER}}`) — do not leave fields blank
just because they are optional/voluntary.

Example placeholders the planner may emit when a value is missing:

- {{APPLICANT_FULL_NAME}}
- {{APPLICANT_EMAIL}}
- {{APPLICANT_PHONE}}
- {{LINKEDIN_PROFILE_URL}}
- {{RESUME_FILE}}
- {{WHY_COMPANY_RESPONSE}}

## Profile

```yaml
{
  _id: '6a5f994d7b1e919b975c9d06',
  name: 'Oliver Baltay',
  autoBidProfile: {
    fullName: 'Oliver Baltay',
    firstName: 'Oliver',
    lastName: 'Baltay',
    age: '31',
    address: '826 N Thornton Ave',
    city: 'Orlando',
    state: 'Florida',
    country: 'United States',
    zipCode: '32803',
    desiredSalary: '140000',
    gender: 'male',
    pronouns: 'he/him',
    sexualOrientation: 'heterosexual',
    email: 'oliverbaltay.piggy@gmail.com',
    deepseekApiKey: '',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4-nano',
    phone: '(689) 800-4885',
    linkedin: 'https://www.linkedin.com/in/oli-t-king',
    github: 'https://github.com/kings-ace511',
    portfolioUrl: 'https://github.com/kings-ace511',
    education: [
      {
        school: 'Columbia University',
        diploma: 'Master\'s Degree in Computer Science',
        startMonth: '8',
        startYear: '2017',
        endMonth: '5',
        endYear: '2018'
      },
      {
        school: 'Washington University in St.Louis',
        diploma: 'Bachelor\'s Degree in Systems Engineering',
        startMonth: '8',
        startYear: '2013',
        endMonth: '5',
        endYear: '2017'
      }
    ],
    careers: [
      {
        company: 'Airbnb',
        title: 'Senior Software Engineer',
        description: '',
        startMonth: '9',
        startYear: '2025',
        endPresent: true,
        endMonth: '',
        endYear: ''
      },
      {
        company: 'Square',
        title: 'Senior Software Engineer',
        description: '',
        startMonth: '9',
        startYear: '2022',
        endPresent: false,
        endMonth: '9',
        endYear: '2025'
      },
      {
        company: 'Hopper',
        title: 'Senior Software Engineer',
        description: '',
        startMonth: '6',
        startYear: '2021',
        endPresent: false,
        endMonth: '9',
        endYear: '2022'
      },
      {
        company: 'Expedia Group',
        title: 'Software Engineer',
        description: '',
        startMonth: '9',
        startYear: '2019',
        endPresent: false,
        endMonth: '6',
        endYear: '2021'
      },
      {
        company: 'KPMG US',
        title: 'Software Engineer',
        description: '',
        startMonth: '8',
        startYear: '2018',
        endPresent: false,
        endMonth: '9',
        endYear: '2019'
      }
    ],
    prefSponsorship: false,
    prefVeteranFriendly: false,
    prefDisabilityFriendly: false,
    demographicHispanic: 'no',
    demographicRaceEthnicity: 'asian',
    demographicDisability: 'no',
    demographicMilitaryStatus: 'not_protected',
    sponsorship: 'no',
    immigrationStatus: 'us_citizen'
  }
}
```
