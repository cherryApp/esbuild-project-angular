import { ChangeDetectionStrategy, Component } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  title = 'Cserkó Abigél';

  list$: BehaviorSubject<{name: string}[]> = new BehaviorSubject<{name: string}[]>([]);

  listObserver$: Observable<any> = this.list$.asObservable();

  users = [
    {name: 'Gazsika'},
    {name: 'Pisti'},
    {name: 'Géza'},
  ];
}
