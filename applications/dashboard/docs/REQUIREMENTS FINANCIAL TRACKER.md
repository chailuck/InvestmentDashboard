# Perfornal Financila planner and tracker
I would like to have another menu for the personal financial portfolio tracker and planner to log each user financial status. The example is in attached. The requirements are: 

_Last updated: 2026-08-22_

---

## 1. Functional Requirements

### Financila planner and tracker
This feature will be accessed via new menu in sidebar named "Tracking". Position of the menu is under the Action Plan.

### Tracking Meta data management
System shall provide the "Category" menu under the tracking to manage the Tracking set, category, sub-category
#### Portfolio tracking set requirements
Portfolio tracking set is to allow user to manage multiple multiple set for different propose.
- Each login user can create his own multiple financial portfolio tracker set.
- The tracking set is for each login users. Not the shared set for anyother users.

#### Tracker category
- In Each portfolio tracker set,  user can create the multiple tracker Category. 
- When create new tracker set, system will automatically create the category which the default values of the category are "Assets", "Liabilities", 
- Category fields are Name, Order, Remark

#### Tracker sub-cateogory
- Users can configure the multiple Sub-category under each category: 
- Each category can have the different list of sub-category
- When create the new category, system will create the "Current Assets", "Long-term Investoment","Property" under the "Assets" category. System will creae the "Current Liabilities", Long-term Liabilities" sub-category under the "Liabilities" cateogry. 
- Sub-category fields are Name, Order, Remark
### Tracking items management
Tracking items is the items which user need to provide the details of the investment for saving, such as cash in back account, provident funds or property. 
Each tracking items shall have the following fields:
- Items name
- Type: Bank account, property, Investment Account, TaxSaving, Materils, Insurance
- Initial Investment Tracking?: Yes/No
- Exclusive: Yes/No (Default is No)
- Order: Numeric
- Items description:
- Account name: 
- Remark
#### Initial investment tracking
If Initial investment tracking of the item is yes:
- Each tracking items shall have a page to let user to add/reduce the original investment amount
- Each Tracking invesment amount shall capture the date, amount

### Capturing the updated balance of the items
- Under the "Tracking" menu, system shall have "Update" sub-menu
- When user access the page, system shall show the list of "Update tracking list" in the table.
- Update tracking list is the list maintain the updated balance of each tracking items.  
- At the top of page, user can choose the "tracking set" whcih "the update tracking" is belong to. One tracking list can be under only one tracking set. One tracking set can have multiple update tracking list depned on the period. 
- At the top system also show the button to create the new tracking the create new list button.
- Tracking list header shall have Tracsaction Date, Quater/Year
#### Update tracking list detail
When user create/manage the update tracking list, system will navaget to the update tracking list page
- Update tracking list page shows the hierachy of the category, sub-category, Tracking items.
- Provide the "Latest Balance" field to let user update the latest balance of the tracking items. 
- When the "Latest Balance" has value, another field to show the Increate/Decrease amount/percentage of the same items from the previous list. 

### Show the updated balance
"Dashbaord" submenu under the "Tracking" menu. In the dashboard submenu, there is one tab to show detail balance tracking. 
- Detail balance tracking has the table which right side will show category, sub-category, items. Each column wil have the list of each quarter of the year. 1 set of rows will have Q1-Q4 of each year. Another year will be in separated set. 
- There is option to show 1 set of rows each year or show every quater in the same row set.



## 2. Technical Requirements
- Can we use the new backend services for this requirment but still share the same frontend and DB or other components so that we can restrat this pod without impacting to the current functionalities.